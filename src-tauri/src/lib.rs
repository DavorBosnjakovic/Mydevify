use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod server;

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileEntry>>,
}

#[derive(Serialize, Deserialize)]
pub struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

// Store the allowed project path
static mut PROJECT_PATH: Option<PathBuf> = None;

// Store the dev server child process PID so we can kill it later
static DEV_SERVER_PROCESS: Mutex<Option<u32>> = Mutex::new(None);

#[tauri::command]
fn set_project_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() || !path_buf.is_dir() {
        return Err("Invalid directory path".to_string());
    }
    // Canonicalize to resolve any symlinks and get absolute path
    let canonical = path_buf.canonicalize().map_err(|e| e.to_string())?;
    unsafe {
        PROJECT_PATH = Some(canonical);
    }
    Ok(())
}

#[tauri::command]
fn get_project_path() -> Option<String> {
    unsafe {
        PROJECT_PATH.as_ref().map(|p| p.to_string_lossy().to_string())
    }
}

fn is_path_allowed(requested: &PathBuf) -> bool {
    unsafe {
        if let Some(ref allowed) = PROJECT_PATH {
            // If path exists, canonicalize and check directly
            if let Ok(canonical) = requested.canonicalize() {
                return canonical.starts_with(allowed);
            }
            // For new files/dirs that don't exist yet, walk up until we find
            // an existing ancestor and verify it's within the project scope
            let mut ancestor = requested.parent();
            while let Some(parent) = ancestor {
                if let Ok(canonical_parent) = parent.canonicalize() {
                    return canonical_parent.starts_with(allowed);
                }
                ancestor = parent.parent();
            }
        }
    }
    false
}

#[tauri::command]
fn read_directory(path: String, depth: u32) -> Result<Vec<FileEntry>, String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }

    read_dir_recursive(&path_buf, depth)
}

fn read_dir_recursive(path: &PathBuf, depth: u32) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    
    let dir = fs::read_dir(path).map_err(|e| e.to_string())?;
    
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        
        // Skip hidden files and node_modules
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        
        let is_dir = entry_path.is_dir();
        let children = if is_dir && depth > 0 {
            read_dir_recursive(&entry_path, depth - 1).ok()
        } else {
            None
        };
        
        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }
    
    // Sort: directories first, then files, alphabetically
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    
    Ok(entries)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    fs::read_to_string(&path_buf).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    // Create parent directories if they don't exist
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    fs::write(&path_buf, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    fs::create_dir_all(&path_buf).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    if !is_path_allowed(&path_buf) {
        return Err("Access denied: path outside project scope".to_string());
    }
    
    if path_buf.is_dir() {
        fs::remove_dir_all(&path_buf).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path_buf).map_err(|e| e.to_string())
    }
}

// ── Terminal Commands ──────────────────────────────────────────

#[tauri::command]
fn execute_command(command: String, cwd: String) -> Result<CommandResult, String> {
    let cwd_path = PathBuf::from(&cwd);

    // Verify cwd exists
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err(format!("Directory not found: {}", cwd));
    }

    let trimmed = command.trim().to_string();

    // Build the shell command based on OS
    // On Windows: /D disables AutoRun, /S strips outer quotes so
    // Rust's argument quoting doesn't break multi-word commands
    let output = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd.exe")
            .arg("/D")
            .arg("/S")
            .arg("/C")
            .arg(&trimmed)
            .current_dir(&cwd_path)
            .output()
    } else {
        std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(&trimmed)
            .current_dir(&cwd_path)
            .output()
    };

    match output {
        Ok(out) => Ok(CommandResult {
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            exit_code: out.status.code().unwrap_or(-1),
        }),
        Err(e) => Err(format!("Failed to execute command: {}", e)),
    }
}

#[tauri::command]
fn resolve_path(cwd: String, target: String) -> Result<String, String> {
    let target_path = if PathBuf::from(&target).is_absolute() {
        PathBuf::from(&target)
    } else {
        PathBuf::from(&cwd).join(&target)
    };

    // Canonicalize to resolve ".." and "." and verify it exists
    let resolved = target_path
        .canonicalize()
        .map_err(|_| format!("cd: no such directory: {}", target))?;

    if !resolved.is_dir() {
        return Err(format!("cd: not a directory: {}", target));
    }

    Ok(resolved.to_string_lossy().to_string())
}

// ── Preview Server Commands ─────────────────────────────────────

#[tauri::command]
async fn start_preview_server(path: String) -> Result<u16, String> {
    server::start(&path, 3456).await
}

#[tauri::command]
fn stop_preview_server() -> Result<(), String> {
    server::stop();
    Ok(())
}

#[tauri::command]
fn get_preview_port() -> Option<u16> {
    server::get_port()
}

// ── Dev Server Commands (for framework projects) ────────────────

/// Helper to build a hidden shell command.
/// On Windows, sets CREATE_NO_WINDOW so no console flashes.
fn build_hidden_shell_command(command: &str, cwd: &PathBuf) -> std::process::Command {
    let mut cmd;

    if cfg!(target_os = "windows") {
        cmd = std::process::Command::new("cmd.exe");
        cmd.arg("/D").arg("/S").arg("/C").arg(command);
    } else {
        cmd = std::process::Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
    }

    cmd.current_dir(cwd);

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    cmd
}

/// Start a long-running dev server process (e.g. `npm run dev`).
/// Captures stdout/stderr, watches for a localhost port in the output,
/// and returns the port once detected (or errors after timeout).
#[tauri::command]
async fn start_dev_server(command: String, cwd: String, port_pattern: String) -> Result<u16, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    // Kill any existing dev server first
    stop_dev_server_internal();

    let cwd_path = PathBuf::from(&cwd);
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err(format!("Directory not found: {}", cwd));
    }

    // Spawn the dev server process with piped stdout and stderr
    let mut child = {
        let mut cmd = build_hidden_shell_command(&command, &cwd_path);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.spawn()
    }
    .map_err(|e| format!("Failed to start dev server: {}", e))?;

    // Store the PID so we can kill it later
    let pid = child.id();
    {
        let mut proc = DEV_SERVER_PROCESS.lock().map_err(|e| e.to_string())?;
        *proc = Some(pid);
    }

    // Compile the port pattern regex
    let re = regex::Regex::new(&port_pattern)
        .map_err(|e| format!("Invalid port pattern: {}", e))?;

    // Take stdout and stderr handles
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Read both stdout and stderr in separate threads,
    // looking for the port pattern in either stream.
    // Dev servers vary — some print to stdout, some to stderr.
    let (tx, rx) = std::sync::mpsc::channel::<Result<u16, String>>();

    // Spawn stdout reader
    if let Some(out) = stdout {
        let re_clone = re.clone();
        let tx_clone = tx.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Some(caps) = re_clone.captures(&line) {
                        if let Some(port_str) = caps.get(1) {
                            if let Ok(port) = port_str.as_str().parse::<u16>() {
                                let _ = tx_clone.send(Ok(port));
                                return;
                            }
                        }
                    }
                }
            }
            let _ = tx_clone.send(Err("Dev server stdout closed without printing a port".to_string()));
        });
    }

    // Spawn stderr reader
    if let Some(err_stream) = stderr {
        let re_clone = re.clone();
        let tx_clone = tx.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err_stream);
            let mut captured = String::new();
            for line in reader.lines() {
                if let Ok(line) = line {
                    // Keep last ~2000 chars of stderr for error reporting
                    if captured.len() < 2000 {
                        captured.push_str(&line);
                        captured.push('\n');
                    }
                    if let Some(caps) = re_clone.captures(&line) {
                        if let Some(port_str) = caps.get(1) {
                            if let Ok(port) = port_str.as_str().parse::<u16>() {
                                let _ = tx_clone.send(Ok(port));
                                return;
                            }
                        }
                    }
                }
            }
            let _ = tx_clone.send(Err(format!(
                "Dev server exited without starting. Output:\n{}",
                if captured.is_empty() { "(no output)".to_string() } else { captured }
            )));
        });
    }

    // Drop the extra sender so rx doesn't hang forever if both threads exit
    drop(tx);

    // Wait for a port with a 30-second timeout
    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(port)) => Ok(port),
        Ok(Err(e)) => {
            stop_dev_server_internal();
            Err(e)
        }
        Err(_) => {
            stop_dev_server_internal();
            Err("Dev server timed out after 30 seconds without printing a port. Try running the command manually in the terminal.".to_string())
        }
    }
}

/// Internal helper to kill the dev server process tree
fn stop_dev_server_internal() {
    let pid = {
        let mut proc = DEV_SERVER_PROCESS.lock().unwrap_or_else(|e| e.into_inner());
        proc.take()
    };

    if let Some(pid) = pid {
        kill_process_tree(pid);
    }
}

/// Kill a process and all its children
fn kill_process_tree(pid: u32) {
    if cfg!(target_os = "windows") {
        // taskkill /T kills the tree, /F forces it
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let _ = cmd.output();
    } else {
        // Kill the process group on Unix
        let _ = std::process::Command::new("kill")
            .args(["-9", &format!("-{}", pid)])
            .output();
        // Fallback: kill just the process
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

/// Stop the dev server — exposed to frontend
#[tauri::command]
fn stop_dev_server() -> Result<(), String> {
    stop_dev_server_internal();
    Ok(())
}

// ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            set_project_path,
            get_project_path,
            read_directory,
            read_file,
            write_file,
            create_directory,
            delete_path,
            execute_command,
            resolve_path,
            start_preview_server,
            stop_preview_server,
            get_preview_port,
            start_dev_server,
            stop_dev_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}