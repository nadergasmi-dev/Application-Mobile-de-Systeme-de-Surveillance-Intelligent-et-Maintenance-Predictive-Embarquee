import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, AlertCircle, XCircle,
  CheckCircle, RefreshCw, Thermometer, Waves
} from 'lucide-react';
import { createClient } from '../utils/supabase/client';
import { getThresholds } from '../config/thresholds';

const MACHINE_TYPE_LOOKUP: Record<string, string> = {
  '0': 'cnc',
  '1': 'compressor',
  '2': 'pump',
  '3': 'robotic_arm',
  cnc: 'cnc',
  compressor: 'compressor',
  pump: 'pump',
  robotic_arm: 'robotic_arm',
};

const getMachineType = () => {
  if (typeof window === 'undefined') return 'cnc';
  try {
    const config = localStorage.getItem('machineConfig');
    if (!config) return 'cnc';
    const parsed = JSON.parse(config) as { machineType?: string };
    return MACHINE_TYPE_LOOKUP[parsed.machineType ?? ''] ?? 'cnc';
  } catch {
    return 'cnc';
  }
};

// ─── Types ────────────────────────────────────────────────
interface SensorRow {
  id: number;
  created_at: string;
  temperature: number;
  rms: number;
}

interface LocalEvent {
  id: string;
  created_at: string;
  source: 'temperature' | 'vibration';
  level: 'alarm' | 'warn';
  value: number;
  threshold: number;
  message: string;
}

// ─── Générer les events localement depuis sensor_data ────
function generateEvents(rows: SensorRow[]): LocalEvent[] {
  const events: LocalEvent[] = [];
  const thresholds = getThresholds(getMachineType());

  for (const r of rows) {
    // ── Temperature
    if (r.temperature >= thresholds.temperature.alarm) {
      events.push({
        id:         `temp-alarm-${r.id}`,
        created_at: r.created_at,
        source:     'temperature',
        level:      'alarm',
        value:      r.temperature,
        threshold:  thresholds.temperature.alarm,
        message:    `ALARM: Temperature ${r.temperature.toFixed(1)}°C exceeded ${thresholds.temperature.alarm}°C limit`,
      });
    } else if (r.temperature >= thresholds.temperature.warn) {
      events.push({
        id:         `temp-warn-${r.id}`,
        created_at: r.created_at,
        source:     'temperature',
        level:      'warn',
        value:      r.temperature,
        threshold:  thresholds.temperature.warn,
        message:    `WARN: Temperature ${r.temperature.toFixed(1)}°C exceeded ${thresholds.temperature.warn}°C limit`,
      });
    }

    // ── Vibration RMS
    if (r.rms >= thresholds.vibration.alarm) {
      events.push({
        id:         `vib-alarm-${r.id}`,
        created_at: r.created_at,
        source:     'vibration',
        level:      'alarm',
        value:      r.rms,
        threshold:  thresholds.vibration.alarm,
        message:    `ALARM: Vibration RMS ${r.rms.toFixed(2)} mm/s exceeded ${thresholds.vibration.alarm} mm/s limit`,
      });
    } else if (r.rms >= thresholds.vibration.warn) {
      events.push({
        id:         `vib-warn-${r.id}`,
        created_at: r.created_at,
        source:     'vibration',
        level:      'warn',
        value:      r.rms,
        threshold:  thresholds.vibration.warn,
        message:    `WARN: Vibration RMS ${r.rms.toFixed(2)} mm/s exceeded ${thresholds.vibration.warn} mm/s limit`,
      });
    }
  }

  // Plus récent en premier
  return events.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// ─── Level style ──────────────────────────────────────────
const getLevelStyle = (level: string) => {
  switch (level) {
    case 'alarm':
      return {
        bg:    'bg-red-500/10 border-red-500/30',
        text:  'text-red-400',
        icon:  <XCircle className="w-5 h-5 text-red-400" />,
        badge: 'bg-red-500/20 text-red-300',
        label: 'Alarm',
      };
    case 'warn':
      return {
        bg:    'bg-orange-500/10 border-orange-500/30',
        text:  'text-[#FFB84E]',
        icon:  <AlertCircle className="w-5 h-5 text-[#FFB84E]" />,
        badge: 'bg-[#FFB84E]/20 text-[#FFB84E]',
        label: 'Warning',
      };
    default:
      return {
        bg:    'bg-green-500/10 border-green-500/30',
        text:  'text-green-400',
        icon:  <CheckCircle className="w-5 h-5 text-green-400" />,
        badge: 'bg-green-500/20 text-green-300',
        label: 'Info',
      };
  }
};

const getSourceIcon = (source: string) =>
  source === 'temperature'
    ? <Thermometer className="w-4 h-4 text-orange-400" />
    : <Waves className="w-4 h-4 text-blue-400" />;

const formatSource = (source: string) =>
  source.charAt(0).toUpperCase() + source.slice(1);

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  );
};

export default function Events() {
  const navigate = useNavigate();
  const supabase = createClient();

  const [events,  setEvents]  = useState<LocalEvent[]>([]);
  const [filter,  setFilter]  = useState<'all' | 'temperature' | 'vibration'>('all');
  const [loading, setLoading] = useState(true);

  // ─── Fetch sensor_data des dernières 24h ─────────────
  const fetchEvents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sensor_data')
        .select('id, created_at, temperature, rms')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(5000);

      if (!error && data) {
        setEvents(generateEvents(data as SensorRow[]));
      }
    } catch (err) {
      console.error('Events fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvents(); }, []);

  // ─── Filter ───────────────────────────────────────────
  const filteredEvents = filter === 'all'
    ? events
    : events.filter(e => e.source === filter);

  const countFor = (src: string) =>
    src === 'all' ? events.length : events.filter(e => e.source === src).length;

  return (
    <div className="min-h-screen bg-[#262525]">
      {/* Header */}
      <div className="bg-[#1a1a1a] border-b border-gray-800">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate('/monitoring')}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-white font-bold text-lg flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5 text-[#FFB84E]" />
                <span>EVENTS & ALERTS</span>
              </h1>
              <p className="text-gray-400 text-xs">
                {filteredEvents.length} event(s) · last 24h
                {filter !== 'all' && ` — ${formatSource(filter)}`}
              </p>
            </div>
          </div>
          <button
            onClick={fetchEvents}
            className="p-2 text-gray-400 hover:text-[#FFB84E] transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>


      {/* ─── Filter buttons ──────────────────────────────── */}
      <div className="px-6 py-2 flex gap-2">
        {(['all', 'temperature', 'vibration'] as const).map(src => (
          <button
            key={src}
            onClick={() => setFilter(src)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center space-x-1 ${
              filter === src
                ? 'bg-[#FFB84E] text-[#262525]'
                : 'bg-[#1a1a1a] text-gray-400 border border-gray-700 hover:border-[#FFB84E]/50'
            }`}
          >
            {src !== 'all' && getSourceIcon(src)}
            <span>{src === 'all' ? 'All' : formatSource(src)}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              filter === src ? 'bg-[#262525]/30' : 'bg-gray-700'
            }`}>
              {countFor(src)}
            </span>
          </button>
        ))}
      </div>

      {/* ─── Events list ─────────────────────────────────── */}
      <div className="px-6 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-[#FFB84E] border-t-transparent" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4 opacity-50" />
            <p className="text-gray-400 text-lg font-medium">No alerts</p>
            <p className="text-gray-600 text-sm mt-1">All values within thresholds in the last 24h</p>
          </div>
        ) : (
          filteredEvents.map(event => {
            const style = getLevelStyle(event.level);
            return (
              <div key={event.id} className={`rounded-xl p-4 border ${style.bg}`}>
                {/* Top row */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    {style.icon}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>
                      {style.label}
                    </span>
                    <span className="flex items-center space-x-1 text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">
                      {getSourceIcon(event.source)}
                      <span>{formatSource(event.source)}</span>
                    </span>
                  </div>
                  <span className="text-gray-500 text-xs whitespace-nowrap">
                    {formatDate(event.created_at)}
                  </span>
                </div>

                {/* Message */}
                <p className={`text-sm font-medium ${style.text} mb-2`}>{event.message}</p>

                {/* Value / Threshold */}
                <div className="flex space-x-4">
                  <span className="text-gray-500 text-xs">
                    Value:{' '}
                    <span className="text-white font-medium">{event.value.toFixed(2)}</span>
                  </span>
                  <span className="text-gray-500 text-xs">
                    Threshold:{' '}
                    <span className="text-gray-300 font-medium">{event.threshold.toFixed(2)}</span>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}