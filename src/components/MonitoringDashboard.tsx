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

function buildAveragedPoints(
  rows: RawSensor[],
  getBucket: (d: Date) => string
): ChartPoint[] {
  const buckets: Record<string, { temps: number[]; vibs: number[] }> = {};
  const order: string[] = [];
  for (const r of rows) {
    const key = getBucket(new Date(r.created_at));
    if (!buckets[key]) { buckets[key] = { temps: [], vibs: [] }; order.push(key); }
    if (r.temperature != null) buckets[key].temps.push(r.temperature);
    if (r.rms != null)         buckets[key].vibs.push(r.rms);
  }
  return order.map(label => {
    const { temps, vibs } = buckets[label];
    const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
    const rmsVib  = vibs.length  ? Math.sqrt(vibs.reduce((a, b) => a + b * b, 0) / vibs.length) : 0;
    return { label, temperature: parseFloat(avgTemp.toFixed(2)), vibration: parseFloat(rmsVib.toFixed(3)) };
  });
}

function computeLive5Min(rows: RawSensor[]): { avgTemp: number; rmsVib: number } {
  const temps = rows.map(r => r.temperature).filter(v => v != null);
  const vibs  = rows.map(r => r.rms).filter(v => v != null);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const rmsVib  = vibs.length  ? Math.sqrt(vibs.reduce((a, b) => a + b * b, 0) / vibs.length) : 0;
  return { avgTemp: parseFloat(avgTemp.toFixed(2)), rmsVib: parseFloat(rmsVib.toFixed(3)) };
}

export default function MonitoringDashboard() {
  const navigate = useNavigate();
  const supabase = createClient();

  const [secondData, setSecondData] = useState<ChartPoint[]>([]);
  const [minuteData, setMinuteData] = useState<ChartPoint[]>([]);
  const [hourData,   setHourData]   = useState<ChartPoint[]>([]);
  const [currentTemp,      setCurrentTemp]      = useState<number>(0);
  const [currentVibration, setCurrentVibration] = useState<number>(0);
  const [prediction, setPrediction]   = useState<AiPrediction | null>(null);
  const [motorConfig, setMotorConfig] = useState<MotorConfig | null>(null);
  const [loading, setLoading]         = useState(true);
  const [lastUpdate, setLastUpdate]   = useState('');
  const [chartView, setChartView]     = useState<ChartView>('second');

  const lastTempWarnNotif  = useRef<number>(0);
  const lastTempAlarmNotif = useRef<number>(0);
  const lastVibWarnNotif   = useRef<number>(0);
  const lastVibAlarmNotif  = useRef<number>(0);
  const lastFailNotif      = useRef<number>(0);
  const notifId            = useRef<number>(1);
  const COOLDOWN_WARN  = 300_000;
  const COOLDOWN_ALARM = 120_000;
  const prevAiTemp      = useRef<number | null>(null);
  const prevAiVib       = useRef<number | null>(null);
  const lastPredictionRef  = useRef<number>(0);
  const motorConfigRef     = useRef<MotorConfig | null>(null);
  const checkThresholdsRef = useRef<(t: number, v: number, f: number) => void>(() => {});

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

  useEffect(() => { checkThresholdsRef.current = checkThresholds; });
  useEffect(() => { lastPredictionRef.current = prediction?.failure ?? 0; }, [prediction]);
  useEffect(() => { motorConfigRef.current = motorConfig; }, [motorConfig]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    LocalNotifications.createChannel({ id: 'motor_critical', name: 'Critical Alarms', description: 'Temperature alarm, vibration alarm, AI failure prediction', importance: 5, sound: 'default', vibration: true, lights: true, lightColor: '#FF0000' }).catch(console.error);
    LocalNotifications.createChannel({ id: 'motor_alerts', name: 'Warning Alerts', description: 'Early-warning alerts for temperature and vibration', importance: 4, sound: 'default', vibration: true, lights: true, lightColor: '#FFB84E' }).catch(console.error);
    LocalNotifications.requestPermissions().catch(console.error);
  }, []);

  useEffect(() => {
    const sensorChannel = supabase
      .channel('realtime:sensor_data')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_data' }, (payload) => {
        const row = payload.new as { temperature: number; rms: number };
        if (!row) return;
        const temp = parseFloat((row.temperature ?? 0).toFixed(2));
        const vib  = parseFloat((row.rms         ?? 0).toFixed(3));
        setCurrentTemp(prev => { checkThresholdsRef.current(temp, vib, lastPredictionRef.current); return temp; });
        setCurrentVibration(vib);
        const tChanged = prevAiTemp.current === null || prevAiTemp.current !== temp;
        const vChanged = prevAiVib.current  === null || prevAiVib.current  !== vib;
        if (tChanged || vChanged) {
          prevAiTemp.current = temp; prevAiVib.current = vib;
          supabase.from('ai_inputs').insert({ temp, vib }).then(({ error }) => { if (error) console.error('ai_inputs insert error:', error); });
        }
        fetchSensorData();
      })
      .subscribe();

    const aiChannel = supabase
      .channel('realtime:ai_models')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_models' }, (payload) => {
        const ai = payload.new as AiPrediction;
        if (!ai) return;
        setPrediction(ai);
        lastPredictionRef.current = ai.failure;
        const d = new Date(ai.created_at);
        setLastUpdate(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      })
      .subscribe();

    return () => { supabase.removeChannel(sensorChannel); supabase.removeChannel(aiChannel); };
  }, []);

  const sendNotification = async (title: string, body: string, channelId = 'motor_alerts') => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await LocalNotifications.schedule({ notifications: [{ title, body, id: notifId.current++, schedule: { at: new Date(Date.now() + 150) }, sound: 'default', channelId, actionTypeId: '', extra: null }] });
    } catch (err) { console.error('Local notification error:', err); }
  };

  const checkThresholds = (temp: number, vib: number, failure: number) => {
    const now = Date.now();
    const cfg = motorConfigRef.current;
    const th  = getThresholds(cfg?.motor_type);
    const machine = MACHINE_TYPE_LABELS[cfg?.motor_type ?? ''] ?? 'Equipment';
    const tempWarnL  = th.temperature.warn;
    const tempAlarmL = th.temperature.alarm;
    const vibWarnL   = th.vibration.warn;
    const vibAlarmL  = th.vibration.alarm;

    if (temp >= tempAlarmL && now - lastTempAlarmNotif.current > COOLDOWN_ALARM) {
      lastTempAlarmNotif.current = now;
      sendNotification('🔴 CRITICAL ALARM — High Temperature', `[${machine}] Temperature: ${temp.toFixed(1)} °C — Alarm threshold: ${tempAlarmL} °C\nThe equipment is operating above the critical limit. Initiate an emergency shutdown and perform an immediate thermal inspection to prevent irreversible damage.`, 'motor_critical');
    } else if (temp >= tempWarnL && temp < tempAlarmL && now - lastTempWarnNotif.current > COOLDOWN_WARN) {
      lastTempWarnNotif.current = now;
      sendNotification('⚠️ WARNING — Elevated Temperature', `[${machine}] Temperature: ${temp.toFixed(1)} °C — Warning threshold: ${tempWarnL} °C\nTemperature is approaching the critical alarm limit. Reduce operational load, verify cooling system performance, and monitor continuously.`, 'motor_alerts');
    }
    if (vib >= vibAlarmL && now - lastVibAlarmNotif.current > COOLDOWN_ALARM) {
      lastVibAlarmNotif.current = now;
      sendNotification('🔴 CRITICAL ALARM — Excessive Vibration', `[${machine}] Vibration: ${vib.toFixed(2)} mm/s — Alarm threshold: ${vibAlarmL} mm/s\nVibration level is critically high. Stop the machine immediately and inspect for mechanical imbalance, bearing failure, or coupling misalignment.`, 'motor_critical');
    } else if (vib >= vibWarnL && vib < vibAlarmL && now - lastVibWarnNotif.current > COOLDOWN_WARN) {
      lastVibWarnNotif.current = now;
      sendNotification('⚠️ WARNING — High Vibration Level', `[${machine}] Vibration: ${vib.toFixed(2)} mm/s — Warning threshold: ${vibWarnL} mm/s\nVibration level is above the acceptable limit. Inspect mountings, couplings, and rotational balance. Schedule preventive maintenance if condition persists.`, 'motor_alerts');
    }
    if (failure === 1 && now - lastFailNotif.current > COOLDOWN_ALARM) {
      lastFailNotif.current = now;
      sendNotification('🚨 AI ALERT — Failure Risk Detected', `[${machine}] Predictive diagnostic model has identified a high probability of equipment failure within the next 24 hours.\nRecommended action: halt non-critical operations and schedule a targeted maintenance inspection immediately.`, 'motor_critical');
    }
  };

  const fetchSensorData = async () => {
    try {
      const { data: sec } = await supabase.from('sensor_data').select('id, created_at, temperature, rms').gte('created_at', new Date(Date.now() - 60 * 1000).toISOString()).order('created_at', { ascending: true });
      if (sec) setSecondData(buildRawPoints(sec as RawSensor[]));

      const { data: min } = await supabase.from('sensor_data').select('id, created_at, temperature, rms').gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()).order('created_at', { ascending: true });
      if (min) setMinuteData(buildAveragedPoints(min as RawSensor[], d => `${pad(d.getHours())}:${pad(d.getMinutes())}`));

      const { data: hr } = await supabase.from('sensor_data').select('id, created_at, temperature, rms').gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).order('created_at', { ascending: false }).limit(50000);
      if (hr) setHourData(buildAveragedPoints([...(hr as RawSensor[])].reverse(), d => `${pad(d.getHours())}:00`));

      const { data: live5 } = await supabase.from('sensor_data').select('temperature, rms').gte('created_at', new Date(Date.now() - 60 * 1000).toISOString()).order('created_at', { ascending: true });
      if (live5 && live5.length > 0) {
        const { avgTemp, rmsVib } = computeLive5Min(live5 as RawSensor[]);
        setCurrentTemp(avgTemp); setCurrentVibration(rmsVib);
        checkThresholds(avgTemp, rmsVib, prediction?.failure ?? 0);
        const tempChanged = prevAiTemp.current === null || prevAiTemp.current !== avgTemp;
        const vibChanged  = prevAiVib.current  === null || prevAiVib.current  !== rmsVib;
        if (tempChanged || vibChanged) {
          prevAiTemp.current = avgTemp; prevAiVib.current = rmsVib;
          const { error } = await supabase.from('ai_inputs').insert({ temp: avgTemp, vib: rmsVib });
          if (error) console.error('ai_inputs insert error:', error);
        }
      }
    } catch (err) { console.error('Sensor fetch error:', err); }
  };

  const fetchPredictions = async () => {
    try {
      const { data: ai } = await supabase.from('ai_models').select('failure, ftype, rulhours, created_at').order('created_at', { ascending: false }).limit(1).single();
      if (ai) { setPrediction(ai as AiPrediction); const d = new Date(ai.created_at); setLastUpdate(`${pad(d.getHours())}:${pad(d.getMinutes())}`); }
      const { data: config } = await supabase.from('motor_config').select('motor_type, operating_mode, hours_sm').order('updated_at', { ascending: false }).limit(1).single();
      if (config) setMotorConfig(config as MotorConfig);
    } catch (err) { console.error('Prediction fetch error:', err); }
    finally { setLoading(false); }
  };

  const fetchAll = async () => { await Promise.all([fetchSensorData(), fetchPredictions()]); };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, []);

  const chartData: ChartPoint[] = { second: secondData, minute: minuteData, hour: hourData }[chartView];
  const chartSubtitle = { second: 'Last 60 seconds', minute: 'Last 60 minutes', hour: 'Last 24 hours' }[chartView];

  const handleLogout = () => { localStorage.removeItem('machineConfig'); navigate('/login'); };

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
            <button onClick={fetchAll} className="p-2 text-gray-400 hover:text-[#FFB84E] transition-colors"><RefreshCw className="w-5 h-5" /></button>
            <button onClick={() => navigate('/machine-setup')} className="p-2 text-gray-400 hover:text-[#FFB84E] transition-colors"><Settings className="w-5 h-5" /></button>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><LogOut className="w-5 h-5" /></button>
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

              {/* Remaining Useful Life — % donut */}
              <div className="bg-[#0f0f0f] rounded-lg p-4 border border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-5 h-5 text-blue-400" />
                    <span className="text-gray-300 text-sm font-medium">Remaining Useful Life</span>
                  </div>
                  <Gauge className="w-5 h-5 text-gray-600" />
                </div>

                {(() => {
                  const pct = Math.min(100, Math.max(0, Math.round(parseFloat(String(prediction.rulhours)) || 0)));
                  const color = pct > 50 ? '#22c55e' : pct > 20 ? '#FFB84E' : '#ef4444';
                  const badge = pct > 50
                    ? 'bg-green-500/10 text-green-400 border-green-500/30'
                    : pct > 20
                      ? 'bg-[#FFB84E]/10 text-[#FFB84E] border-[#FFB84E]/30'
                      : 'bg-red-500/10 text-red-400 border-red-500/30';
                  const label = pct > 50 ? 'GOOD CONDITION' : pct > 20 ? 'SCHEDULE MAINTENANCE' : 'CRITICAL — ACT NOW';
                  const circ = 2 * Math.PI * 38;
                  const offset = circ * (1 - pct / 100);

                  return (
                    <>
                      <div className="flex items-center gap-5">
                        <svg width="90" height="90" viewBox="0 0 90 90" className="flex-shrink-0">
                          <circle cx="45" cy="45" r="38" fill="none" stroke="#1f2937" strokeWidth="9" />
                          <circle
                            cx="45" cy="45" r="38" fill="none"
                            stroke={color} strokeWidth="9"
                            strokeDasharray={circ} strokeDashoffset={offset}
                            strokeLinecap="round"
                            style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px', transition: 'stroke-dashoffset .5s' }}
                          />
                          <text x="45" y="50" textAnchor="middle" fontSize="15" fontWeight="700" fill="white">
                            {pct}%
                          </text>
                        </svg>
                        <div className="flex-1">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge}`}>
                            ● {label}
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Failure Forecast */}
              <div className={`rounded-lg p-4 border ${failureDetected ? 'bg-red-500/10 border-red-500/40' : 'bg-[#0f0f0f] border-gray-800'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    {failureDetected ? <ShieldAlert className="w-5 h-5 text-red-400" /> : <ShieldCheck className="w-5 h-5 text-green-400" />}
                    <span className="text-gray-300 text-sm font-medium">Failure Forecast — Next 24 Hours</span>
                  </div>
                  <TrendingUp className="w-5 h-5 text-gray-600" />
                </div>
                {failureDetected ? (
                  <>
                    <div className="flex items-center space-x-2 mb-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse">● FAILURE RISK DETECTED</span>
                    </div>
                    <p className="text-white text-sm leading-relaxed">The diagnostic model has identified a high likelihood of equipment failure within the next 24 hours. Immediate inspection is strongly recommended.</p>
                    <div className="mt-4 bg-[#0f0f0f] rounded-lg p-3 border border-red-500/20">
                      <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2">Predicted Failure Mode</p>
                      <div className="flex items-center space-x-3">
                        <div className="w-1 h-8 rounded bg-red-500 flex-shrink-0" />
                        <div>
                          <p className="text-white font-semibold">{FAILURE_TYPE_LABELS[prediction.ftype] ?? 'Undetermined Failure'}</p>
                          <p className="text-gray-500 text-xs mt-0.5">Schedule a targeted inspection of this component.</p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center space-x-2 mb-3">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-500/20 text-green-300 border border-green-500/30">● NO FAILURE RISK</span>
                    </div>
                    <p className="text-gray-400 text-sm leading-relaxed">All monitored parameters are within acceptable limits. No failure events are anticipated in the next 24 hours. Continue regular monitoring.</p>
                  </>
                )}
              </div>

            </div>
          </div>
        )}

        {/* Sensor Values */}
        <div className="grid grid-cols-2 gap-4">
          <div className={`rounded-xl p-5 border ${currentTemp > tempAlarm ? 'bg-red-500/20 border-red-500/50' : currentTemp > tempWarn ? 'bg-[#FFB84E]/10 border-[#FFB84E]/20' : 'bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20'}`}>
            <div className="flex items-center space-x-2 mb-3">
              <Thermometer className={`w-5 h-5 ${currentTemp > tempAlarm ? 'text-red-400' : currentTemp > tempWarn ? 'text-[#FFB84E]' : 'text-orange-400'}`} />
              <p className="text-gray-300 text-xs font-medium">TEMPERATURE</p>
              {currentTemp > tempWarn && <span className="text-red-400 text-xs animate-pulse">!</span>}
            </div>
            <p className={`text-4xl font-bold ${currentTemp > tempAlarm ? 'text-red-400' : currentTemp > tempWarn ? 'text-[#FFB84E]' : 'text-white'}`}>{currentTemp.toFixed(1)}</p>
            <p className="text-orange-300 text-sm mt-1">°C</p>
          </div>

          <div className={`rounded-xl p-5 border ${currentVibration > vibAlarm ? 'bg-red-500/20 border-red-500/50' : currentVibration > vibWarn ? 'bg-[#FFB84E]/10 border-[#FFB84E]/20' : 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/20'}`}>
            <div className="flex items-center space-x-2 mb-3">
              <Waves className={`w-5 h-5 ${currentVibration > vibAlarm ? 'text-red-400' : currentVibration > vibWarn ? 'text-[#FFB84E]' : 'text-blue-400'}`} />
              <p className="text-gray-300 text-xs font-medium">VIBRATION RMS</p>
              {currentVibration > vibWarn && <span className="text-red-400 text-xs animate-pulse">!</span>}
            </div>
            <p className={`text-4xl font-bold ${currentVibration > vibAlarm ? 'text-red-400' : currentVibration > vibWarn ? 'text-[#FFB84E]' : 'text-white'}`}>{currentVibration.toFixed(2)}</p>
            <p className="text-blue-300 text-sm mt-1">mm/s</p>
          </div>
        </div>

        {/* Charts */}
        <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-gray-400 text-sm font-medium">SENSOR TRENDS</h3>
            <div className="flex space-x-1 bg-[#0f0f0f] rounded-lg p-1">
              {chartTabs.map(tab => (
                <button key={tab.key} onClick={() => setChartView(tab.key)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${chartView === tab.key ? 'bg-[#FFB84E] text-[#262525]' : 'text-gray-400 hover:text-white'}`}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-gray-600 text-xs mb-4">{chartSubtitle}</p>
          {chartData.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">No data available</p>
              <p className="text-gray-600 text-xs mt-1">{chartView === 'second' ? 'Waiting for data in the last 60 seconds...' : chartView === 'minute' ? 'No data recorded in the last 60 minutes.' : 'No data recorded in the last 24 hours.'}</p>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-xs mb-2">Temperature (°C)</p>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="label" stroke="#666" tick={{ fill: '#666', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #FFB84E', borderRadius: '8px', color: '#fff' }} labelStyle={{ color: '#FFB84E' }} />
                  <Line type="monotone" dataKey="temperature" stroke="#FFB84E" strokeWidth={2} dot={false} name="Temp (°C)" />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-gray-500 text-xs mb-2 mt-5">Vibration RMS (mm/s)</p>
              <ResponsiveContainer width="100%" height={175}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="label" stroke="#666" tick={{ fill: '#666', fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #60a5fa', borderRadius: '8px', color: '#fff' }} labelStyle={{ color: '#60a5fa' }} />
                  <Line type="monotone" dataKey="vibration" stroke="#60a5fa" strokeWidth={2} dot={false} name="Vibration RMS (mm/s)" />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* Events */}
        <div className="bg-[#1a1a1a] rounded-xl border border-gray-800">
          <button onClick={() => navigate('/events')} className="w-full p-4 flex items-center justify-between hover:bg-[#0f0f0f] transition-colors group">
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