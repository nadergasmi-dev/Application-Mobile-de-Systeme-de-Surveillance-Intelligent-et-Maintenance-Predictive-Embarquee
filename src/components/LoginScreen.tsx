import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import { createClient } from '../utils/supabase/client';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import motorLogo from '../imports/MOTOR_(2).png';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const navigate = useNavigate();
  const [emailOrUserId, setEmailOrUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();
      let email = emailOrUserId;

      if (!emailOrUserId.includes('@')) {
        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/server/get-email-from-userid`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${publicAnonKey}`,
            },
            body: JSON.stringify({ userId: emailOrUserId }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          setError('User ID not found');
          setLoading(false);
          return;
        }

        email = data.email;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      if (signInData?.session) {
        onLogin();
        navigate('/machine-setup');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred during login');
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();

      if (Capacitor.isNativePlatform()) {
        // ✅ MOBILE — Custom Tab (approuvé par Google, s'ouvre PAR-DESSUS l'app)
        const { data, error: signInError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: 'com.motorwatch.app://oauth/callback',
            skipBrowserRedirect: true,
          },
        });

        if (signInError) {
          setError(signInError.message);
          setLoading(false);
          return;
        }

        if (data?.url) {
          await Browser.open({
            url: data.url,
            windowName: '_self',
          });
        }

      } else {
        // ✅ WEB — OAuth normal
        const { error: signInError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/oauth/callback`,
          },
        });

        if (signInError) {
          setError(signInError.message);
          setLoading(false);
        }
      }

    } catch (err: any) {
      console.error('Google login error:', err);
      setError(`Google login error: ${err?.message || 'Unknown error'}`);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#262525] flex flex-col px-6 py-8">
      <div className="flex justify-center mb-8">
        <img src={motorLogo} alt="Motor Watch" className="w-48 h-48 object-contain" />
      </div>

      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white mb-2 text-center">Welcome Back</h2>
          <p className="text-gray-400 text-center">Sign in to monitor your equipment</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email or User ID</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={emailOrUserId}
                onChange={(e) => setEmailOrUserId(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg py-3.5 pl-12 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FFB84E] transition-colors"
                placeholder="email@company.com or userid"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg py-3.5 pl-12 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FFB84E] transition-colors"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <div className="text-right">
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-[#FFB84E] text-sm font-medium hover:underline"
            >
              Forgot password?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FFB84E] text-[#262525] font-semibold py-3.5 rounded-lg hover:bg-[#ffa31a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-[#262525] text-gray-400">Or continue with</span>
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="mt-4 w-full bg-white text-gray-800 font-semibold py-3.5 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center space-x-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>

        <div className="mt-6 text-center">
          <p className="text-gray-400 text-sm">
            Don't have an account?{' '}
            <button onClick={() => navigate('/signup')} className="text-[#FFB84E] font-medium hover:underline">
              Sign Up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}