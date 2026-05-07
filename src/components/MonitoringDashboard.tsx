import React, { useState, useEffect, useRef } from 'react';
import Chatbot from './Chatbot';
import { useNavigate } from 'react-router-dom';
import { 
  Activity, Thermometer, Waves, AlertTriangle, CheckCircle, 
  Clock, TrendingUp, Gauge, ChevronRight, Settings, LogOut,
  XCircle, AlertCircle
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import motorLogo from '../imports/MOTOR_(2).png';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

// ✅ Seuils d'alerte
const TEMP_THRESHOLD = 78;    // °C — alerte si dépassé
const VIB_THRESHOLD = 3.5;    // mm/s — alerte si dépassé
const FAILURE_PROB_THRESHOLD = 65; // % — alerte si dépassé

interface SensorData {
  timestamp: string;
  hour: string;
  temperature: number;
  vibration: number;
  id: string;
}

interface PredictionData {
  rul: number;
  failureProbability: number;
  failureDetected: boolean;
  failureTypes: { type: string; probability: number }[];
}

const FAILURE_TYPES = ['bearing', 'motor_overheat', 'hydraulic', 'electrical'];

export default function MonitoringDashboard() {
  const navigate = useNavigate();
  const [sensorData, setSensorData] = useState<SensorData[]>([]);
  const [currentTemp, setCurrentTemp] = useState(0);
  const [currentVibration, setCurrentVibration] = useState(0);
  const [prediction, setPrediction] = useState<PredictionData>({
    rul: 450,
    failureProbability: 85,
    failureDetected: true,
    failureTypes: [
      { type: 'bearing', probability: 52.3 },
      { type: 'motor_overheat', probability: 28.1 },
      { type: 'hydraulic', probability: 12.4 },
      { type: 'electrical', probability: 7.2 }
    ]
  });

  // ✅ Cooldown pour éviter les notifications répétitives
  const lastTempNotif = useRef<number>(0);
  const lastVibNotif = useRef<number>(0);
  const lastFailureNotif = useRef<number>(0);
  const notifId = useRef<number>(1);

  const machineConfig = JSON.parse(localStorage.getItem('machineConfig') || '{}');

  // ✅ Initialiser les permissions de notifications
  useEffect(() => {
    const initNotifications = async () => {
      if (!Capacitor.isNativePlatform()) return;
      try {
        const permission = await LocalNotifications.requestPermissions();
        console.log('Notification permission:', permission.display);
      } catch (err) {
        console.error('Notification permission error:', err);
      }
    };
    initNotifications();
  }, []);

  // ✅ Envoyer une notification locale
  const sendNotification = async (title: string, body: string, id: number) => {
    if (!Capacitor.isNativePlatform()) {
      console.log(`[Notification] ${title}: ${body}`);
      return;
    }
    try {
      await LocalNotifications.schedule({
        notifications: [{
          title,
          body,
          id,
          schedule: { at: new Date(Date.now() + 100) },
          sound: 'default',
          actionTypeId: '',
          extra: null,
        }]
      });
    } catch (err) {
      console.error('Notification error:', err);
    }
  };

  // ✅ Vérifier les seuils et envoyer notifications (cooldown 60s)
  const checkThresholds = (temp: number, vib: number, failureProb: number) => {
    const now = Date.now();
    const COOLDOWN = 60000; // 60 secondes entre notifications

    // Alerte température
    if (temp > TEMP_THRESHOLD && now - lastTempNotif.current > COOLDOWN) {
      lastTempNotif.current = now;
      sendNotification(
        '🌡️ Temperature Alert',
        `Temperature ${temp}°C exceeds threshold of ${TEMP_THRESHOLD}°C! Check motor cooling.`,
        notifId.current++
      );
    }

    // Alerte vibration
    if (vib > VIB_THRESHOLD && now - lastVibNotif.current > COOLDOWN) {
      lastVibNotif.current = now;
      sendNotification(
        '⚡ Vibration Alert',
        `Vibration ${vib} mm/s exceeds threshold of ${VIB_THRESHOLD} mm/s! Check bearings.`,
        notifId.current++
      );
    }

    // Alerte probabilité de panne
    if (failureProb > FAILURE_PROB_THRESHOLD && now - lastFailureNotif.current > COOLDOWN) {
      lastFailureNotif.current = now;
      sendNotification(
        '🚨 Failure Risk Detected',
        `Failure probability ${failureProb}% is critical! Immediate inspection required.`,
        notifId.current++
      );
    }
  };

  // Initialize 24h historical data
  useEffect(() => {
    const now = new Date();
    const historicalData: SensorData[] = [];
    
    for (let i = 47; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 30 * 60 * 1000);
      const hour = timestamp.getHours();
      const minute = timestamp.getMinutes();
      const hourFactor = Math.sin((hour - 6) * Math.PI / 12);
      const baseTemp = 70 + hourFactor * 8;
      const temp = baseTemp + (Math.random() - 0.5) * 3;
      const baseVib = 2.2 + hourFactor * 1.2;
      const vib = Math.max(0.5, baseVib + (Math.random() - 0.5) * 0.6);
      
      historicalData.push({
        timestamp: timestamp.toISOString(),
        hour: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        temperature: parseFloat(temp.toFixed(1)),
        vibration: parseFloat(vib.toFixed(2)),
        id: `data-${i}`
      });
    }
    
    setSensorData(historicalData);
    if (historicalData.length > 0) {
      const latest = historicalData[historicalData.length - 1];
      setCurrentTemp(latest.temperature);
      setCurrentVibration(latest.vibration);
    }
  }, []);

  // ✅ Real-time sensor data + vérification des seuils
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const hourStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const hourFactor = Math.sin((hour - 6) * Math.PI / 12);
      const baseTemp = 70 + hourFactor * 8;
      const temp = parseFloat((baseTemp + (Math.random() - 0.5) * 3).toFixed(1));
      const baseVib = 2.2 + hourFactor * 1.2;
      const vib = parseFloat(Math.max(0.5, baseVib + (Math.random() - 0.5) * 0.6).toFixed(2));

      setCurrentTemp(temp);
      setCurrentVibration(vib);

      setSensorData(prev => {
        const newData = [...prev, {
          timestamp: now.toISOString(),
          hour: hourStr,
          temperature: temp,
          vibration: vib,
          id: `data-${now.getTime()}-${Math.random()}`
        }];
        return newData.slice(-48);
      });

      // Simulate ML predictions
      if (Math.random() > 0.7) {
        const failureProb = parseFloat(Math.min(100, Math.max(0, 15 + (Math.random() - 0.5) * 50)).toFixed(1));
        const isFailure = failureProb > 65;
        
        let failureTypes: { type: string; probability: number }[] = [];
        if (isFailure) {
          const types = FAILURE_TYPES.map(type => ({ type, probability: Math.random() * 100 }));
          const total = types.reduce((sum, t) => sum + t.probability, 0);
          failureTypes = types.map(t => ({
            type: t.type,
            probability: parseFloat(((t.probability / total) * 100).toFixed(1))
          })).sort((a, b) => b.probability - a.probability);
        }

        setPrediction(prev => {
          // ✅ Vérifier seuils à chaque mise à jour de prediction
          checkThresholds(temp, vib, failureProb);
          return {
            rul: Math.max(0, 2500 - Math.floor(Math.random() * 100)),
            failureProbability: failureProb,
            failureDetected: isFailure,
            failureTypes
          };
        });
      } else {
        // ✅ Vérifier seuils même sans update de prediction
        checkThresholds(temp, vib, prediction.failureProbability);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [prediction.failureProbability]);

  const getHealthStatus = () => {
    if (prediction.failureDetected) return { status: 'FAULT', color: 'bg-red-500', icon: <XCircle className="w-6 h-6" /> };
    if (prediction.failureProbability > 40) return { status: 'WARNING', color: 'bg-[#FFB84E]', icon: <AlertCircle className="w-6 h-6" /> };
    return { status: 'NORMAL', color: 'bg-green-500', icon: <CheckCircle className="w-6 h-6" /> };
  };

  const getFailureTypeLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      'bearing': 'Bearing Failure',
      'motor_overheat': 'Motor Overheat',
      'hydraulic': 'Hydraulic Issue',
      'electrical': 'Electrical Fault'
    };
    return labels[type] || type;
  };

  const health = getHealthStatus();
  const chartData = sensorData.filter((_, index) => index % 2 === 0);

  return (
    <div className="min-h-screen bg-[#262525]">
      {/* Header */}
      <div className="bg-[#1a1a1a] border-b border-gray-800">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img src={motorLogo} alt="Motor Watch" className="w-10 h-10 object-contain" />
              <div>
                <h1 className="text-white font-bold text-lg">LIVE MONITORING</h1>
                <p className="text-gray-400 text-xs">Real-time predictive maintenance</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={() => navigate('/machine-setup')} className="p-2 text-gray-400 hover:text-[#FFB84E] transition-colors" title="Reconfigure Machine">
                <Settings className="w-5 h-5" />
              </button>
              <button onClick={() => { localStorage.removeItem('machineConfig'); navigate('/login'); }} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Logout">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6 pb-8">
        {/* Machine Info */}
        <div className="bg-[#1a1a1a] rounded-xl p-4 border border-gray-800">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-gray-400 text-xs mb-1">CONFIGURED MACHINE</p>
              <p className="text-white font-medium capitalize">{machineConfig.machineType?.replace('_', ' ') || 'Unknown'}</p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 text-xs mb-1">OPERATING MODE</p>
              <p className="text-[#FFB84E] font-bold capitalize">{machineConfig.operatingMode || 'Unknown'}</p>
            </div>
            <div className="text-right">
              <p className="text-gray-400 text-xs mb-1">HOURS SINCE MAINTENANCE</p>
              <p className="text-[#FFB84E] font-bold text-lg">{machineConfig.hoursSinceMaintenance || 0}h</p>
            </div>
          </div>
        </div>

        {/* ✅ Alert Thresholds Info */}
        <div className="bg-[#1a1a1a] rounded-xl p-4 borde
        r border-gray-800">
          <p className="text-gray-400 text-xs font-medium mb-2">ALERT THRESHOLDS</p>
          <div className="flex space-x-4">
            <div className="flex items-center space-x-2">
              <Thermometer className="w-4 h-4 text-orange-400" />
              <span className={`text-sm font-medium ${currentTemp > TEMP_THRESHOLD ? 'text-red-400' : 'text-gray-300'}`}>
                {currentTemp > TEMP_THRESHOLD ? '🔴' : '🟢'} Temp &gt; {TEMP_THRESHOLD}°C
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Waves className="w-4 h-4 text-blue-400" />
              <span className={`text-sm font-medium ${currentVibration > VIB_THRESHOLD ? 'text-red-400' : 'text-gray-300'}`}>
                {currentVibration > VIB_THRESHOLD ? '🔴' : '🟢'} Vib &gt; {VIB_THRESHOLD} mm/s
              </span>
            </div>
          </div>
        </div>

        {/* Health Status Card */}
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
        <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
          <h3 className="text-[#FFB84E] text-sm font-bold mb-4 flex items-center space-x-2">
            <Activity className="w-5 h-5" />
            <span>AI PREDICTIONS</span>
          </h3>
          <div className="space-y-4">
            <div className="bg-[#0f0f0f] rounded-lg p-4 border border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Clock className="w-5 h-5 text-blue-400" />
                  <span className="text-gray-300 text-sm font-medium">Remaining Useful Life</span>
                </div>
                <Gauge className="w-5 h-5 text-gray-600" />
              </div>
              <p className="text-3xl font-bold text-white">{prediction.rul.toLocaleString()}h</p>
              <p className="text-gray-500 text-xs mt-1">{Math.floor(prediction.rul / 24)} days {prediction.rul % 24} hours</p>
              <div className="mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
                <div className="bg-gradient-to-r from-green-500 to-blue-500 h-full transition-all duration-500" style={{ width: `${Math.min(100, (prediction.rul / 3000) * 100)}%` }}></div>
              </div>
            </div>

            <div className="bg-[#0f0f0f] rounded-lg p-4 border border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-5 h-5 text-orange-400" />
                  <span className="text-gray-300 text-sm font-medium">Failure Probability in next 24h</span>
                </div>
                <TrendingUp className="w-5 h-5 text-gray-600" />
              </div>
              <p className="text-3xl font-bold text-white">{prediction.failureProbability}%</p>
              <p className="text-gray-500 text-xs mt-1">{prediction.failureDetected ? 'Failure detected' : 'Normal operation'}</p>
              <div className="mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
                <div className={`h-full transition-all duration-500 ${prediction.failureProbability > 60 ? 'bg-red-500' : prediction.failureProbability > 40 ? 'bg-[#FFB84E]' : 'bg-green-500'}`} style={{ width: `${prediction.failureProbability}%` }}></div>
              </div>
            </div>

            {prediction.failureDetected && prediction.failureTypes.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <XCircle className="w-5 h-5 text-red-400" />
                  <span className="text-sm font-medium text-red-300">Detected Failure Type</span>
                </div>
                <div className="flex items-center justify-between bg-[#0f0f0f] rounded-lg p-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-1 h-10 rounded bg-red-500"></div>
                    <span className="text-white font-medium">{getFailureTypeLabel(prediction.failureTypes[0].type)}</span>
                  </div>
                  <span className="text-red-400 font-bold text-lg">{prediction.failureTypes[0].probability}%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Real-time Sensor Values */}
        <div className="grid grid-cols-2 gap-4">
          {/* Temperature */}
          <div className={`rounded-xl p-5 border ${currentTemp > TEMP_THRESHOLD ? 'bg-red-500/20 border-red-500/50' : 'bg-gradient-to-br from-orange-500/10 to-red-500/10 border-orange-500/20'}`}>
            <div className="flex items-center space-x-2 mb-3">
              <Thermometer className={`w-5 h-5 ${currentTemp > TEMP_THRESHOLD ? 'text-red-400' : 'text-orange-400'}`} />
              <p className="text-gray-300 text-xs font-medium">TEMPERATURE</p>
              {currentTemp > TEMP_THRESHOLD && <span className="text-red-400 text-xs font-bold animate-pulse">⚠️</span>}
            </div>
            <p className={`text-4xl font-bold ${currentTemp > TEMP_THRESHOLD ? 'text-red-400' : 'text-white'}`}>{currentTemp}</p>
            <p className="text-orange-300 text-sm mt-1">°C {currentTemp > TEMP_THRESHOLD && `(limit: ${TEMP_THRESHOLD}°C)`}</p>
          </div>

          {/* Vibration */}
          <div className={`rounded-xl p-5 border ${currentVibration > VIB_THRESHOLD ? 'bg-red-500/20 border-red-500/50' : 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/20'}`}>
            <div className="flex items-center space-x-2 mb-3">
              <Waves className={`w-5 h-5 ${currentVibration > VIB_THRESHOLD ? 'text-red-400' : 'text-blue-400'}`} />
              <p className="text-gray-300 text-xs font-medium">VIBRATION RMS</p>
              {currentVibration > VIB_THRESHOLD && <span className="text-red-400 text-xs font-bold animate-pulse">⚠️</span>}
            </div>
            <p className={`text-4xl font-bold ${currentVibration > VIB_THRESHOLD ? 'text-red-400' : 'text-white'}`}>{currentVibration}</p>
            <p className="text-blue-300 text-sm mt-1">mm/s {currentVibration > VIB_THRESHOLD && `(limit: ${VIB_THRESHOLD})`}</p>
          </div>
        </div>

        {/* Charts */}
        <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
          <h3 className="text-gray-400 text-sm font-medium mb-4">TEMPERATURE TREND (LAST 24H)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="hour" stroke="#666" tick={{ fill: '#666', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} domain={[60, 90]} />
              <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #FFB84E', borderRadius: '8px', color: '#fff' }} labelStyle={{ color: '#FFB84E' }} />
              <Line type="monotone" dataKey="temperature" stroke="#FFB84E" strokeWidth={2} dot={false} name="Temp (°C)" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#1a1a1a] rounded-xl p-5 border border-gray-800">
          <h3 className="text-gray-400 text-sm font-medium mb-4">VIBRATION TREND (LAST 24H)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="hour" stroke="#666" tick={{ fill: '#666', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis stroke="#666" tick={{ fill: '#666', fontSize: 10 }} domain={[0, 6]} />
              <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #60a5fa', borderRadius: '8px', color: '#fff' }} labelStyle={{ color: '#60a5fa' }} />
              <Line type="monotone" dataKey="vibration" stroke="#60a5fa" strokeWidth={2} dot={false} name="Vibration (mm/s)" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Navigation */}
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
        failureProbability={prediction.failureProbability}
        healthStatus={health.status}
        machineType={machineConfig.machineType}
        operatingMode={machineConfig.operatingMode}
      />
    </div>
  );
}