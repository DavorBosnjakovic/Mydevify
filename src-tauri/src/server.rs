use axum::Router;
use std::net::SocketAddr;
use std::sync::Mutex;
use tokio::sync::oneshot;
use tower_http::services::ServeDir;

// Server state - tracks the running server so we can shut it down
static SERVER_SHUTDOWN: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
static SERVER_PORT: Mutex<Option<u16>> = Mutex::new(None);

/// Start a static file server for the given project directory.
/// Tries the preferred port first, falls back to an OS-assigned port if busy.
/// Returns the port the server is listening on.
pub async fn start(project_path: &str, preferred_port: u16) -> Result<u16, String> {
    // Stop any existing server first
    stop();

    let path = std::path::PathBuf::from(project_path);
    if !path.exists() || !path.is_dir() {
        return Err("Invalid project path".to_string());
    }

    let service = ServeDir::new(project_path)
        .append_index_html_on_directories(true);

    let app = Router::new().fallback_service(service);

    // Try preferred port first, fall back to port 0 (OS picks available port)
    let listener = match tokio::net::TcpListener::bind(
        SocketAddr::from(([127, 0, 0, 1], preferred_port))
    ).await {
        Ok(l) => l,
        Err(_) => {
            // Preferred port busy — let OS assign one
            tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
                .await
                .map_err(|e| format!("Failed to bind any port: {}", e))?
        }
    };

    let actual_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    // Create a shutdown signal
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Spawn the server in the background
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    // Store the shutdown handle and port
    *SERVER_SHUTDOWN.lock().unwrap() = Some(shutdown_tx);
    *SERVER_PORT.lock().unwrap() = Some(actual_port);

    Ok(actual_port)
}

/// Stop the running preview server.
pub fn stop() {
    if let Some(tx) = SERVER_SHUTDOWN.lock().unwrap().take() {
        let _ = tx.send(());
    }
    *SERVER_PORT.lock().unwrap() = None;
}

/// Get the port of the currently running server, if any.
pub fn get_port() -> Option<u16> {
    *SERVER_PORT.lock().unwrap()
}