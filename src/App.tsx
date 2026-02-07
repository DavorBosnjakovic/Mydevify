import { useEffect } from "react";
import MainLayout from "./components/layout/MainLayout";
import { retestAllConnections } from "./services/connections";

function App() {
  // Re-test all saved connections on app startup
  useEffect(() => {
    retestAllConnections();
  }, []);

  return <MainLayout />;
}

export default App;