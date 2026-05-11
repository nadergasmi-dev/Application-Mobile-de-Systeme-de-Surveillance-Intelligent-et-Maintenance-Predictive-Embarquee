import React, { useState, useEffect, useRef } from 'react';
import Chatbot from './Chatbot';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Thermometer, Waves, AlertTriangle, CheckCircle,
  Clock, TrendingUp, Gauge, ChevronRight, Settings, LogOut,
  XCircle, AlertCircle, RefreshCw
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import motorLogo from '../imports/MOTOR_(2).png';
import { createClient } from '../utils/supabase/client';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

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

// ─── Alert thresholds ────────────────────────────────────
const TEMP_THRESHOLD = 78;
const VIB_THRESHOLD  = 3.5;
const FAIL_THRESHOLD = 65;

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
  failure_conf: number;
  ftype: number;
  ftype_conf: number;
  rulhours: number;
  avg_temp: number;
  avg_rms: number;
  created_at: string;
}

interface MotorConfig {
  motor_type: string;
  operating_mode: string;
  hours_sm: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

// ─── Build chart points from raw rows ────────────────────
// ✅ No timezone comparison — just format the dates for display
function buildSecondPoints(rows: RawSensor[]): ChartPoint[] {
  return rows.map(r => {
    const d = new Date(r.created_at);
    return {
      label: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      temperature: r.temperature ?? 0,
      vibration:   r.rms ?? 0,
    };
  });
}

function buildAggregatedPoints(
  rows: RawSensor[],
  getBucket: (d: Date) => string
): ChartPoint[] {
  const buckets: Record<string, { temps: number[]; vibs: number[] }> = {};
  for (const r of rows) {
    const key = getBucket(new Date(r.created_at));
    if (!buckets[key]) buckets[key] = { temps: [], vibs: [] };
    buckets[key].temps.push(r.temperature ?? 0);
    buckets[key].vibs.push(r.rms ?? 0);
  }
  return Object.entries(buckets).map(([label, { temps, vibs }]) => ({
    label,
    temperature: parseFloat((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2)),
    vibration:   parseFloat((vibs.reduce((a, b)  => a + b, 0) / vibs.length).toFixed(3)),
  }));
}

export default function MonitoringDashboard() {
  const navigate = useNavigate();
  const supabase = createClient();

  // ✅ Separate state per tab — each fetched independently from Supabase
  const [secondData, setSecondData] = useState<ChartPoint[]>([]);
  const [minuteData, setMinuteData] = useState<ChartPoint[]>([]);
  const [hourData,   setHourData]   = useState<ChartPoint[]>([]);

  const [prediction, setPrediction]   = useState<AiPrediction | null>(null);
  const [motorConfig, setMotorConfig] = useState<MotorConfig | null>(null);
  const [loading, setLoading]         = useState(true);
  const [lastUpdate, setLastUpdate]   = useState('');
  const [chartView, setChartView]     = useState<ChartView>('second');

  // Cooldown refs
  const lastTempNotif = useRef<number>(0);
  const lastVibNotif  = useRef<number>(0);
  const lastFailNotif = useRef<number>(0);
  const notifId       = useRef<number>(1);
  const COOLDOWN      = 60000;

  // ─── Derived values ───────────────────────────────────
  const currentTemp      = prediction?.avg_temp ?? 0;
  const currentVibration = prediction?.avg_rms  ?? 0;
  const failureProbability = prediction
    ? prediction.failure === 1
      ? Math.round(prediction.failure_conf * 100)
      : Math.round((1 - prediction.failure_conf) * 100)
    : 0;
  const failureDetected = prediction?.failure === 1;

  const getHealthStatus = () => {
    if (failureDetected)         return { status: 'FAULT',   color: 'bg-red-500',   icon: <XCircle className="w-6 h-6" /> };
    if (failureProbability > 40) return { status: 'WARNING', color: 'bg-[#FFB84E]', icon: <AlertCircle className="w-6 h-6" /> };
    return                              { status: 'NORMAL',  color: 'bg-green-500', icon: <CheckCircle className="w-6 h-6" /> };
  };
  const health = getHealthStatus();

  // ─── Notifications ────────────────────────────────────
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

  const checkThresholds = (temp: number, vib: number, failProb: number) => {
    const now = Date.now();
    if (temp > TEMP_THRESHOLD && now - lastTempNotif.current > COOLDOWN) {
      lastTempNotif.current = now;
      sendNotification('Temperature Alert', `Temperature ${temp.toFixed(1)} C exceeds ${TEMP_THRESHOLD} C!`);
    }
    if (vib > VIB_THRESHOLD && now - lastVibNotif.current > COOLDOWN) {
      lastVibNotif.current = now;
      sendNotification('Vibration Alert', `Vibration ${vib.toFixed(2)} mm/s exceeds ${VIB_THRESHOLD} mm/s!`);
    }
    if (failProb > FAIL_THRESHOLD && now - lastFailNotif.current > COOLDOWN) {
      lastFailNotif.current = now;
      sendNotification('Failure Risk Detected', `Failure probability: ${failProb}% — Inspection required.`);
    }
  };

  // ─── Fetch sensor data — all windows via Supabase ─────
  // ✅ PostgreSQL handles timezone correctly with NOW() - interval
  const fetchSensorData = async () => {
    try {
      // ── Per Second: last 60 seconds ────────────────────
      const { data: sec } = await supabase
        .from('sensor_data')
        .select('id, created_at, temperature, rms')
        .gte('created_at', new Date(Date.now() - 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (sec) setSecondData(buildSecondPoints(sec as RawSensor[]));

      // ── Per Minute: last 60 minutes ────────────────────
      const { data: min } = await supabase
        .from('sensor_data')
        .select('id, created_at, temperature, rms')
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (min) {
        setMinuteData(buildAggregatedPoints(
          min as RawSensor[],
          d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
        ));
      }

      // ── Per Hour: last 24 hours ─────────────────────────
      const { data: hr } = await supabase
        .from('sensor_data')
        .select('id, created_at, temperature, rms')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (hr) {
        setHourData(buildAggregatedPoints(
          hr as RawSensor[],
          d => `${pad(d.getHours())}:00`
        ));
      }

    } catch (err) {
      console.error('Sensor fetch error:', err);
    }
  };

  // ─── Fetch AI + config ────────────────────────────────
  const fetchPredictions = async () => {
    try {
      const { data: ai } = await supabase
        .from('ai_models')
        .select('failure, failure_conf, ftype, ftype_conf, rulhours, avg_temp, avg_rms, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (ai) {
        setPrediction(ai as AiPrediction);
        const d = new Date(ai.created_at);
        setLastUpdate(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
        const prob = ai.failure === 1
          ? Math.round(ai.failure_conf * 100)
          : Math.round((1 - ai.failure_conf) * 100);
        checkThresholds(ai.avg_temp ?? 0, ai.avg_rms ?? 0, prob);
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

  // ─── Active chart data ────────────────────────────────
  const chartData: ChartPoint[] = {
    second: secondData,
    minute: minuteData,
    hour:   hourData,
  }[chartView];

  const chartSubtitle = {
    second: `last 60 s — ${secondData.length} pts`,
    minute: `avg/min · last 60 min — ${minuteData.length} pts`,
    hour:   `avg/hour · last 24 h — ${hourData.length} pts`,
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
              {/* RUL */}
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
                  <div className="bg-gradient-to-r from-green-500 to-blue-500 h-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (prediction.rulhours / 3000) * 100)}%` }} />
                </div>
              </div>

              {/* Failure Probability */}
              <div className="bg-[#0f0f0f] rounded-lg p-4 border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="w-5 h-5 text-orange-400" />
                    <span className="text-gray-300 text-sm font-medium">Failure Probability (next 24h)</span>
                  </div>
                  <TrendingUp className="w-5 h-5 text-gray-600" />
                </div>
                <p className="text-3xl font-bold text-white">{failureProbability}%</p>
                <p className="text-gray-500 text-xs mt-1">
                  {failureDetected ? 'Failure detected' : 'Normal operation'}
                </p>
                <div className="mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div className={`h-full transition-all duration-500 ${
                    failureProbability > 60 ? 'bg-red-500'
                    : failureProbability > 40 ? 'bg-[#FFB84E]'
                    : 'bg-green-500'
                  }`} style={{ width: `${failureProbability}%` }} />
                </div>
              </div>

              {/* Failure Type — only if failure=1 */}
              {failureDetected && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <XCircle className="w-5 h-5 text-red-400" />
                    <span className="text-sm font-medium text-red-300">Detected Failure Type</span>
                  </div>
                  <div className="flex items-center justify-between bg-[#0f0f0f] rounded-lg p-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-1 h-10 rounded bg-red-500" />
                      <span className="text-white font-medium">
                        {FAILURE_TYPE_LABELS[prediction.ftype] ?? 'Unknown'}
                      </span>
                    </div>
                    <span className="text-red-400 font-bold text-lg">
                      {Math.round(prediction.ftype_conf * 100)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Real-time Sensor Values */}
        <div className="grid grid-cols-2 gap-4">
          <div className={`rounded-xl p-5 border ${currentTemp > TEMP_THRESHOLD
            ? 'bg-red-500/20 border-red-500/50'
            : 'bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20'}`}>
            <div className="flex items-center space-x-2 mb-3">
              <Thermometer className={`w-5 h-5 ${currentTemp > TEMP_THRESHOLD ? 'text-red-400' : 'text-orange-400'}`} />
              <p className="text-gray-300 text-xs font-medium">TEMPERATURE</p>
              {currentTemp > TEMP_THRESHOLD && <span className="text-red-400 text-xs animate-pulse">!</span>}
            </div>
            <p className={`text-4xl font-bold ${currentTemp > TEMP_THRESHOLD ? 'text-red-400' : 'text-white'}`}>
              {currentTemp.toFixed(1)}
            </p>
            <p className="text-orange-300 text-sm mt-1">C</p>
          </div>

          <div className={`rounded-xl p-5 border ${currentVibration > VIB_THRESHOLD
            ? 'bg-red-500/20 border-red-500/50'
            : 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/20'}`}>
            <div className="flex items-center space-x-2 mb-3">
              <Waves className={`w-5 h-5 ${currentVibration > VIB_THRESHOLD ? 'text-red-400' : 'text-blue-400'}`} />
              <p className="text-gray-300 text-xs font-medium">VIBRATION RMS</p>
              {currentVibration > VIB_THRESHOLD && <span className="text-red-400 text-xs animate-pulse">!</span>}
            </div>
            <p className={`text-4xl font-bold ${currentVibration > VIB_THRESHOLD ? 'text-red-400' : 'text-white'}`}>
              {currentVibration.toFixed(2)}
            </p>
            <p className="text-blue-300 text-sm mt-1">mm/s</p>
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
                 : chartView === 'minute' ? 'No data in the last 60 minutes'
                 : 'No data in the last 24 hours'}
              </p>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-xs mb-2">Temperature (C)</p>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="label" stroke="#666" tick={{ fill: '#666', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #FFB84E', borderRadius: '8px', color: '#fff' }} labelStyle={{ color: '#FFB84E' }} />
                  <Line type="monotone" dataKey="temperature" stroke="#FFB84E" strokeWidth={2} dot={false} name="Temp (C)" />
                </LineChart>
              </ResponsiveContainer>

              <p className="text-gray-500 text-xs mb-2 mt-5">Vibration RMS (mm/s)</p>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="label" stroke="#666" tick={{ fill: '#666', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #60a5fa', borderRadius: '8px', color: '#fff' }} labelStyle={{ color: '#60a5fa' }} />
                  <Line type="monotone" dataKey="vibration" stroke="#60a5fa" strokeWidth={2} dot={false} name="Vibration (mm/s)" />
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
        failureProbability={failureProbability}
        healthStatus={health.status}
        machineType={motorConfig ? MACHINE_TYPE_LABELS[motorConfig.motor_type] ?? 'Unknown' : 'Unknown'}
      />
    </div>
  );
}