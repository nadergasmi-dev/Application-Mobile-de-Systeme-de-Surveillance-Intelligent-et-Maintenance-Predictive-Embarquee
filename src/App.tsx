import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import StartScreen from "./components/StartScreen";
import LoginScreen from "./components/LoginScreen";
import SignUpScreen from "./components/SignUpScreen";
import ForgotPasswordScreen from "./components/ForgotPasswordScreen";
import VerifyResetCodeScreen from "./components/VerifyResetCodeScreen";
import MachineSetupScreen from "./components/MachineSetupScreen";
import MonitoringDashboard from "./components/MonitoringDashboard";
import History from "./components/History";
import Events from "./components/Events";
import Settings from "./components/Settings";
import OAuthCallback from "./components/OAuthCallback";
import { createClient } from "./utils/supabase/client";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

// ✅ Doit être DANS le Router pour accéder à useNavigate
function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleAppUrlOpen = async ({ url }: { url: string }) => {
      console.log("Deep link received:", url);

      // Fermer le browser immédiatement
      try { await Browser.close(); } catch (e) {}

      const supabase = createClient();

      try {
        // Extraire les tokens du deep link
        const urlObj = new URL(url);
        const hashParams = new URLSearchParams(urlObj.hash.substring(1));
        const searchParams = urlObj.searchParams;

        const accessToken =
          hashParams.get("access_token") ||
          searchParams.get("access_token");
        const refreshToken =
          hashParams.get("refresh_token") ||
          searchParams.get("refresh_token");

        if (accessToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          });

          if (!error && data.session) {
            navigate("/machine-setup", { replace: true });
            return;
          }
        }

        // Pas de token → vérifier session existante
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          navigate("/machine-setup", { replace: true });
        } else {
          navigate("/login", { replace: true });
        }

      } catch (err) {
        console.error("Deep link error:", err);
        navigate("/login", { replace: true });
      }
    };

    CapApp.addListener("appUrlOpen", handleAppUrlOpen);

    return () => {
      CapApp.removeAllListeners();
    };
  }, [navigate]);

  return null;
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "MotorWatch - Industrial Motor Monitoring";
  }, []);

  useEffect(() => {
    const supabase = createClient();

    // Vérifier session existante
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
      setLoading(false);
    });

    // ✅ Écouter les changements d'auth (Google login inclus)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setIsAuthenticated(!!session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    localStorage.removeItem("machineConfig");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#262525] flex items-center justify-center">
        <div className="text-[#FFB84E] text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <Router>
        {/* ✅ Deep link handler pour Google OAuth sur mobile */}
        <DeepLinkHandler />
        <div className="min-h-screen bg-[#262525]">
          <Routes>
            <Route path="/" element={<StartScreen />} />
            <Route
              path="/login"
              element={
                <LoginScreen onLogin={() => setIsAuthenticated(true)} />
              }
            />
            <Route path="/signup" element={<SignUpScreen />} />
            <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
            <Route path="/verify-reset-code" element={<VerifyResetCodeScreen />} />
            <Route
              path="/machine-setup"
              element={
                isAuthenticated ? (
                  <MachineSetupScreen />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/monitoring"
              element={
                isAuthenticated ? (
                  <MonitoringDashboard />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/dashboard"
              element={
                isAuthenticated ? (
                  <MonitoringDashboard />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/history"
              element={
                isAuthenticated ? (
                  <History />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/events"
              element={
                isAuthenticated ? (
                  <Events />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route
              path="/settings"
              element={
                isAuthenticated ? (
                  <Settings onLogout={handleLogout} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
          </Routes>
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;