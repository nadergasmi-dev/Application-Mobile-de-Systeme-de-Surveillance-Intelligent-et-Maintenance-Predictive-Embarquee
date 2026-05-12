import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '../utils/supabase/client';
import motorLogo from '../imports/MOTOR_(2)-1.png';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        const supabase = createClient();

        if (Capacitor.isNativePlatform()) {
          // ✅ MOBILE — Écoute le deep link de retour
          App.addListener('appUrlOpen', async ({ url }) => {
            console.log('App opened with URL:', url);

            // Fermer le Custom Tab
            await Browser.close();

            // Extraire les tokens du deep link
            const urlObj = new URL(url);
            const accessToken = urlObj.searchParams.get('access_token') 
              || new URLSearchParams(urlObj.hash.substring(1)).get('access_token');
            const refreshToken = urlObj.searchParams.get('refresh_token')
              || new URLSearchParams(urlObj.hash.substring(1)).get('refresh_token');

            if (accessToken) {
              const { data, error: sessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken || '',
              });

              if (sessionError) {
                setError(sessionError.message);
                setIsProcessing(false);
                return;
              }

              if (data.session) {
                navigate('/machine-setup', { replace: true });
              }
            } else {
              // Vérifier si déjà connecté
              const { data: { session } } = await supabase.auth.getSession();
              if (session) {
                navigate('/machine-setup', { replace: true });
              } else {
                navigate('/login', { replace: true });
              }
            }
          });

          // Vérifier si déjà connecté (cas où l'app revient en foreground)
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            await Browser.close();
            navigate('/machine-setup', { replace: true });
          }

        } else {
          // ✅ WEB — comportement normal
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken) {
            const { data, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            });

            if (sessionError) {
              setError(sessionError.message);
              setIsProcessing(false);
              return;
            }


          } else {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              navigate('/machine-setup', { replace: true });
            } else {
              navigate('/login', { replace: true });
            }
          }
        }
      } catch (err) {
        console.error('OAuth callback error:', err);
        setError('An error occurred during authentication');
        setIsProcessing(false);
      }
    };

    handleOAuthCallback();

    // Cleanup listener
    return () => {
      App.removeAllListeners();
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#262525] flex flex-col items-center justify-center px-6">
        <img src={motorLogo} alt="MotorWatch" className="w-32 h-32 object-contain mb-8 animate-pulse" />
        <div className="max-w-md w-full bg-red-500/10 border border-red-500/50 rounded-lg p-6 text-center">
          <h2 className="text-xl font-bold text-red-400 mb-2">Authentication Error</h2>
          <p className="text-red-300 mb-4">{error}</p>
          <button
            onClick={() => navigate('/login')}
            className="bg-[#FFB84E] text-[#262525] font-semibold py-2 px-6 rounded-lg hover:bg-[#ffa31a] transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#262525] flex flex-col items-center justify-center px-6">
      <img src={motorLogo} alt="MotorWatch" className="w-32 h-32 object-contain mb-8 animate-pulse" />
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#FFB84E] border-t-transparent mb-4"></div>
        <h2 className="text-xl font-bold text-white mb-2">Authenticating...</h2>
        <p className="text-gray-400">Please wait while we sign you in</p>
      </div>
    </div>
  );
}