import React, { useState, useEffect, useRef } from 'react';
import Chatbot from './Chatbot';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Thermometer, Waves, AlertTriangle, CheckCircle,
  Clock, TrendingUp, Gauge, ChevronRight, Settings, LogOut,
  XCircle, AlertCircle, RefreshCw, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import motorLogo from '../imports/MOTOR_(2).png';
import { createClient } from '../utils/supabase/client';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getThresholds } from '../config/thresholds';

// ─── Labels ──────────────────────────────────────────────
const MACHINE_TYPE_LABELS: Record<string, string> = {
  '0': 'CNC', '1': 'Compressor', '2': 'Pump', '3': 'Robotic Arm',
};
const OPERATING_MODE_LABELS: Record<string, string> = {
  '0': 'Idle', '1': 'Normal', '2': 'Peak',
};
const FAILURE_TYPE_LABELS: Record<number, string> = {
  0: 'Bearing Failure', 1: 'Motor Overheat',
};

type ChartView = 'second' | 'minute' | 'hour';

interface RawSensor {
  id: number;
  created_at: string;
  temperature: number;
  rms: number;
}

interface ChartPoint {
  label: string;
  temperature: number;
  vibration: number;
}

interface AiPrediction {
  failure: number;
  ftype: number;
  rulhours: number;
  created_at: string;
}

interface MotorConfig {
  motor_type: string;
  operating_mode: string;
  hours_sm: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

// ─── Per Second: raw values ───────────────────────────────
function buildRawPoints(rows: RawSensor[]): ChartPoint[] {
  return rows.map(r => {
    const d = new Date(r.created_at);
    return {
      label: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      temperature: r.temperature ?? 0,
      vibration:   r.rms ?? 0,
    };
  });
}

// ─── Per Minute / Per Hour: avg temp + RMS vibration ─────
function buildAveragedPoints(
  rows: RawSensor[],
  getBucket: (d: Date) => string
): ChartPoint[] {
  const buckets: Record<string, { temps: number[]; vibs: number[] }> = {};
  const order: string[] = [];

  for (const r of rows) {
    const key = getBucket(new Date(r.created_at));
    if (!buckets[key]) {
      buckets[key] = { temps: [], vibs: [] };
      order.push(key);
    }
    if (r.temperature != null) buckets[key].temps.push(r.temperature);
    if (r.rms != null)         buckets[key].vibs.push(r.rms);
  }

  return order.map(label => {
    const { temps, vibs } = buckets[label];

    const avgTemp = temps.length
      ? temps.reduce((a, b) => a + b, 0) / temps.length
      : 0;

    const rmsVib = vibs.length
      ? Math.sqrt(vibs.reduce((a, b) => a + b * b, 0) / vibs.length)
      : 0;

    return {
      label,
      temperature: parseFloat(avgTemp.toFixed(2)),
      vibration:   parseFloat(rmsVib.toFixed(3)),
    };
  });
}

// ─── Compute avg temp and RMS vibration from last-5-min rows ─
function computeLive5Min(rows: RawSensor[]): { avgTemp: number; rmsVib: number } {
  const temps = rows.map(r => r.temperature).filter(v => v != null);
  const vibs  = rows.map(r => r.rms).filter(v => v != null);

  const avgTemp = temps.length
    ? temps.reduce((a, b) => a + b, 0) / temps.length
    : 0;

  const rmsVib = vibs.length
    ? Math.sqrt(vibs.reduce((a, b) => a + b * b, 0) / vibs.length)
    : 0;

  return {
    avgTemp: parseFloat(avgTemp.toFixed(2)),
    rmsVib:  parseFloat(rmsVib.toFixed(3)),
  };
}

export default function MonitoringDashboard() {
  const navigate = useNavigate();
  const supabase = createClient();

  const [secondData, setSecondData] = useState<ChartPoint[]>([]);
  const [minuteData, setMinuteData] = useState<ChartPoint[]>([]);
  const [hourData,   setHourData]   = useState<ChartPoint[]>([]);

  // Live values computed from sensor_data (last 5 min)
  const [currentTemp,      setCurrentTemp]      = useState<number>(0);
  const [currentVibration, setCurrentVibration] = useState<number>(0);

  const [prediction, setPrediction]   = useState<AiPrediction | null>(null);
  const [motorConfig, setMotorConfig] = useState<MotorConfig | null>(null);
  const [loading, setLoading]         = useState(true);
  const [lastUpdate, setLastUpdate]   = useState('');
  const [chartView, setChartView]     = useState<ChartView>('second');

  const lastTempNotif = useRef<number>(0);
  const lastVibNotif  = useRef<number>(0);
  const lastFailNotif = useRef<number>(0);
  const notifId       = useRef<number>(1);
  const COOLDOWN      = 60000;

  const failureDetected = prediction?.failure === 1;

  const thresholds = getThresholds(motorConfig?.motor_type);
  const tempWarn  = thresholds.temperature.warn;
  const tempAlarm = thresholds.temperature.alarm;
  const vibWarn   = thresholds.vibration.warn;
  const vibAlarm  = thresholds.vibration.alarm;

  const getHealthStatus = () => {
    if (failureDetected)
      return { status: 'FAULT',   color: 'bg-red-500',   icon: <XCircle className="w-6 h-6" /> };
    if (currentTemp > tempWarn || currentVibration > vibWarn)
      return { status: 'WARNING', color: 'bg-[#FFB84E]', icon: <AlertCircle className="w-6 h-6" /> };
    return { status: 'NORMAL',  color: 'bg-green-500', icon: <CheckCircle className="w-6 h-6" /> };
  };
  const health = getHealthStatus();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    LocalNotifications.requestPermissions().catch(console.error);
  }, []);

  const sendNotification = async (title: string, body: string) => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await LocalNotifications.schedule({
        notifications: [{ title, body, id: notifId.current++,
          schedule: { at: new Date(Date.now() + 100) },
          sound: 'default', actionTypeId: '', extra: null }]
      });
    } catch {}
  };

  const checkThresholds = (temp: number, vib: number, failure: number) => {
    const now = Date.now();
    const tempThreshold = temp > tempAlarm ? tempAlarm : tempWarn;
    const vibThreshold  = vib  > vibAlarm  ? vibAlarm  : vibWarn;

    if (temp > tempWarn && now - lastTempNotif.current > COOLDOWN) {
      lastTempNotif.current = now;
      sendNotification(
        'Temperature Alert',
        `Temperature ${temp.toFixed(1)} °C exceeds the ${tempThreshold} °C threshold. Immediate inspection recommended.`
      );
    }
    if (vib > vibWarn && now - lastVibNotif.current > COOLDOWN) {
      lastVibNotif.current = now;
      sendNotification(
        'Vibration Alert',
        `Vibration level ${vib.toFixed(2)} mm/s exceeds the ${vibThreshold} mm/s threshold. Please verify machine balance.`
      );
    }
    if (failure === 1 && now - lastFailNotif.current > COOLDOWN) {
      lastFailNotif.current = now;
      sendNotification(
        'Failure Risk Detected',
        'A potential failure has been identified within the next 24 hours. Schedule an inspection immediately.'
      );
    }
  };

  const fetchSensorData = async () => {
    try {
      // ── Per-second chart: last 60 s ──────────────────────
      const { data: sec } = await supabase
        .from('sensor_data')
        .select('id, created_at, temperature, rms')
        .gte('created_at', new Date(Date.now() - 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (sec) setSecondData(buildRawPoints(sec as RawSensor[]));

      // ── Per-minute chart: last 60 min ────────────────────
      const { data: min } = await supabase
        .from('sensor_data')
        .select('id, created_at, temperature, rms')
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (min) {
        setMinuteData(buildAveragedPoints(
          min as RawSensor[],
          d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
        ));
      }

      // ── Per-hour chart: last 24 h ────────────────────────
      const { data: hr } = await supabase
        .from('sensor_data')
        .select('id, created_at, temperature, rms')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50000);

      if (hr) {
        const rows = [...(hr as RawSensor[])].reverse();
        setHourData(buildAveragedPoints(
          rows,
          d => `${pad(d.getHours())}:00`
        ));
      }

      // ── Live values: avg temp + RMS vib over last 5 min ──
      const { data: live5 } = await supabase
        .from('sensor_data')
        .select('temperature, rms')
        .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (live5 && live5.length > 0) {
        const { avgTemp, rmsVib } = computeLive5Min(live5 as RawSensor[]);
        setCurrentTemp(avgTemp);
        setCurrentVibration(rmsVib);
        // Re-check thresholds with updated live values (failure from prediction)
        checkThresholds(avgTemp, rmsVib, prediction?.failure ?? 0);
      }

    } catch (err) {
      console.error('Sensor fetch error:', err);
    }
  };

  const fetchPredictions = async () => {
    try {
      const { data: ai } = await supabase
        .from('ai_models')
        .select('failure, ftype, rulhours, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (ai) {
        setPrediction(ai as AiPrediction);
        const d = new Date(ai.created_at);
        setLastUpdate(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      }

      const { data: config } = await supabase
        .from('motor_config')
        .select('motor_type, operating_mode, hours_sm')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (config) setMotorConfig(config as MotorConfig);
    } catch (err) {
      console.error('Prediction fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAll = async () => {
    await Promise.all([fetchSensorData(), fetchPredictions()]);
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, []);

  const chartData: ChartPoint[] = {
    second: secondData,
    minute: minuteData,
    hour:   hourData,
  }[chartView];

  const chartSubtitle = {
    second: `raw · last 60 s — ${secondData.length} pts`,
    minute: `avg temp · RMS vib/min · last 60 min — ${minuteData.length} pts`,
    hour:   `avg temp · RMS vib/hour · last 24 h — ${hourData.length} pts`,
  }[chartView];

  const handleLogout = () => {
    localStorage.removeItem('machineConfig');
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#262525] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#FFB84E] border-t-transparent mb-4"></div>
          <p className="text-gray-400">Loading data...</p>
        </div>
      </div>
    );
  }

  const chartTabs: { key: ChartView; label: string }[] = [
    { key: 'second', label: 'Per Second' },
    { key: 'minute', label: 'Per Minute' },
    { key: 'hour',   label: 'Per Hour'   },
  ];

  return (
    <div className="min-h-screen bg-[#262525]">
      {/* Header */}
      <div className="bg-[#1a1a1a] border-b border-gray-800">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={motorLogo} alt="MotorWatch" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="text-white font-bold text-lg">LIVE MONITORING</h1>
              <p className="text-gray-400 text-xs">Real-time predictive maintenance</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {lastUpdate && <span className="text-gray-500 text-xs hidden sm:block">Updated: {lastUpdate}</span>}
            <button onClick={fetchAll} className="p-2 text-gray-400 hover:text-[#FFB84E] transition-colors">
              <RefreshCw className="w-5 h-5" />
            </button>
            <button onClick={() => navigate('/machine-setup')} className="p-2 text-gray-400 hover:text-[#FFB84E] transition-colors">
              <Settings className="w-5 h-5" />
            </button>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6 pb-8">

        {/* Machine Info */}
        {motorConfig && (
          <div className="bg-[#1a1a1a] rounded-xl p-4 border border-gray-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs mb-1">CONFIGURED MACHINE</p>
                <p className="text-white font-medium">{MACHINE_TYPE_LABELS[motorConfig.motor_type] ?? 'Unknown'}</p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 text-xs mb-1">OPERATING MODE</p>
                <p className="text-white font-medium">{OPERATING_MODE_LABELS[motorConfig.operating_mode] ?? 'Unknown'}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-xs mb-1">HOURS SINCE MAINTENANCE</p>
                <p className="text-[#FFB84E] font-bold text-lg">{motorConfig.hours_sm ?? 0}h</p>
              </div>
            </div>
          </div>
        )}

        {/* Health Status */}
        <div className="bg-gradient-to-br from-[#1a1a1a] to-[#0f0f0f] rounded-2xl p-6 border border-gray-800 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 text-sm font-medium">SYSTEM HEALTH</h3>
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          </div>
          <div className="flex items-center space-x-4">
            <div className={`${health.color} p-4 rounded-xl text-white`}>{health.icon}</div>
            <div>
              <p className="text-3xl font-bold text-white">{health.status}</p>
              <p className="text-gray-400 text-sm mt-1">Overall Condition</p>
            </div>
          </div>
        </div>

        {/* AI Predictions */}
        {prediction && (
          <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
            <h3 className="text-[#FFB84E] text-sm font-bold mb-4 flex items-center space-x-2">
              <Activity className="w-5 h-5" />
              <span>AI PREDICTIONS</span>
            </h3>
            <div className="space-y-4">

              {/* Remaining Useful Life */}
              <div className="bg-[#0f0f0f] rounded-lg p-4 border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-5 h-5 text-blue-400" />
                    <span className="text-gray-300 text-sm font-medium">Remaining Useful Life</span>
                  </div>
                  <Gauge className="w-5 h-5 text-gray-600" />
                </div>
                <p className="text-3xl font-bold text-white">{Math.round(prediction.rulhours).toLocaleString()}h</p>
                <p className="text-gray-500 text-xs mt-1">
                  {Math.floor(prediction.rulhours / 24)} days {Math.round(prediction.rulhours % 24)} hours
                </p>
                <div className="mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-500 to-blue-500 h-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (prediction.rulhours / 3000) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Failure Forecast — next 24 h */}
              <div className={`rounded-lg p-4 border ${
                failureDetected
                  ? 'bg-red-500/10 border-red-500/40'
                  : 'bg-[#0f0f0f] border-gray-800'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    {failureDetected
                      ? <ShieldAlert className="w-5 h-5 text-red-400" />
                      : <ShieldCheck className="w-5 h-5 text-green-400" />
                    }
                    <span className="text-gray-300 text-sm font-medium">Failure Forecast — Next 24 Hours</span>
                  </div>
                  <TrendingUp className="w-5 h-5 text-gray-600" />
                </div>

                {failureDetected ? (
                  <>
                    <div className="flex items-center space-x-2 mb-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse">
                        ● FAILURE RISK DETECTED
                      </span>
                    </div>
                    <p className="text-white text-sm leading-relaxed">
                      The diagnostic model has identified a high likelihood of equipment failure within the next 24 hours.
                      Immediate inspection is strongly recommended.
                    </p>

                    <div className="mt-4 bg-[#0f0f0f] rounded-lg p-3 border border-red-500/20">
                      <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">
                        Predicted Failure Mode
                      </p>
                      <div className="flex items-center space-x-3">
                        <div className="w-1 h-8 rounded bg-red-500 flex-shrink-0" />
                        <div>
                          <p className="text-white font-semibold">
                            {FAILURE_TYPE_LABELS[prediction.ftype] ?? 'Undetermined Failure'}
                          </p>
                          <p className="text-gray-500 text-xs mt-0.5">
                            Schedule a targeted inspection of this component.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center space-x-2 mb-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-500/20 text-green-300 border border-green-500/30">
                        ● NO FAILURE RISK
                      </span>
                    </div>
                    <p className="text-gray-400 text-sm leading-relaxed">
                      All monitored parameters are within acceptable limits. No failure events are anticipated
                      in the next 24 hours. Continue regular monitoring.
                    </p>
                  </>
                )}
              </div>

            </div>
          </div>
        )}

        {/* Real-time Sensor Values — computed from sensor_data last 5 min */}
        <div className="grid grid-cols-2 gap-4">
          <div className={`rounded-xl p-5 border ${
            currentTemp > tempAlarm
              ? 'bg-red-500/20 border-red-500/50'
              : currentTemp > tempWarn
                ? 'bg-[#FFB84E]/10 border-[#FFB84E]/20'
                : 'bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20'
          }`}>
            <div className="flex items-center space-x-2 mb-3">
              <Thermometer className={`w-5 h-5 ${
                currentTemp > tempAlarm ? 'text-red-400'
                : currentTemp > tempWarn ? 'text-[#FFB84E]'
                : 'text-orange-400'
              }`} />
              <p className="text-gray-300 text-xs font-medium">TEMPERATURE</p>
              {currentTemp > tempWarn && <span className="text-red-400 text-xs animate-pulse">!</span>}
            </div>
            <p className={`text-4xl font-bold ${
              currentTemp > tempAlarm ? 'text-red-400'
              : currentTemp > tempWarn ? 'text-[#FFB84E]'
              : 'text-white'
            }`}>
              {currentTemp.toFixed(1)}
            </p>
            <p className="text-orange-300 text-sm mt-1">°C · avg 5 min</p>
          </div>

          <div className={`rounded-xl p-5 border ${
            currentVibration > vibAlarm
              ? 'bg-red-500/20 border-red-500/50'
              : currentVibration > vibWarn
                ? 'bg-[#FFB84E]/10 border-[#FFB84E]/20'
                : 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/20'
          }`}>
            <div className="flex items-center space-x-2 mb-3">
              <Waves className={`w-5 h-5 ${
                currentVibration > vibAlarm ? 'text-red-400'
                : currentVibration > vibWarn ? 'text-[#FFB84E]'
                : 'text-blue-400'
              }`} />
              <p className="text-gray-300 text-xs font-medium">VIBRATION RMS</p>
              {currentVibration > vibWarn && <span className="text-red-400 text-xs animate-pulse">!</span>}
            </div>
            <p className={`text-4xl font-bold ${
              currentVibration > vibAlarm ? 'text-red-400'
              : currentVibration > vibWarn ? 'text-[#FFB84E]'
              : 'text-white'
            }`}>
              {currentVibration.toFixed(2)}
            </p>
            <p className="text-blue-300 text-sm mt-1">mm/s · RMS 5 min</p>
          </div>
        </div>

        {/* Charts with tabs */}
        <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-gray-400 text-sm font-medium">SENSOR TRENDS</h3>
            <div className="flex space-x-1 bg-[#0f0f0f] rounded-lg p-1">
              {chartTabs.map(tab => (
                <button key={tab.key} onClick={() => setChartView(tab.key)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    chartView === tab.key
                      ? 'bg-[#FFB84E] text-[#262525]'
                      : 'text-gray-400 hover:text-white'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-gray-600 text-xs mb-4">{chartSubtitle}</p>

          {chartData.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">No data available</p>
              <p className="text-gray-600 text-xs mt-1">
                {chartView === 'second' ? 'Waiting for data in the last 60 seconds...'
                 : chartView === 'minute' ? 'No data recorded in the last 60 minutes.'
                 : 'No data recorded in the last 24 hours.'}
              </p>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-xs mb-2">Temperature (°C)</p>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="label" stroke="#666" tick={{ fill: '#666', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #FFB84E', borderRadius: '8px', color: '#fff' }}
                    labelStyle={{ color: '#FFB84E' }}
                  />
                  <Line type="monotone" dataKey="temperature" stroke="#FFB84E" strokeWidth={2} dot={false} name="Temp (°C)" />
                </LineChart>
              </ResponsiveContainer>

              <p className="text-gray-500 text-xs mb-2 mt-5">Vibration RMS (mm/s)</p>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="label" stroke="#666" tick={{ fill: '#666', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #60a5fa', borderRadius: '8px', color: '#fff' }}
                    labelStyle={{ color: '#60a5fa' }}
                  />
                  <Line type="monotone" dataKey="vibration" stroke="#60a5fa" strokeWidth={2} dot={false} name="Vibration RMS (mm/s)" />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* Events Navigation */}
        <div className="bg-[#1a1a1a] rounded-xl border border-gray-800">
          <button onClick={() => navigate('/events')}
            className="w-full p-4 flex items-center justify-between hover:bg-[#0f0f0f] transition-colors group">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="w-5 h-5 text-[#FFB84E]" />
              <span className="text-white font-medium">Events & Alerts</span>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-[#FFB84E] transition-colors" />
          </button>
        </div>
      </div>

      <Chatbot
        currentTemp={currentTemp}
        currentVibration={currentVibration}
        failureProbability={failureDetected ? 100 : 0}
        healthStatus={health.status}
        machineType={motorConfig ? MACHINE_TYPE_LABELS[motorConfig.motor_type] ?? 'Unknown' : 'Unknown'}
      />
    </div>
  );
}