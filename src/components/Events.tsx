import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, AlertCircle, XCircle,
  CheckCircle, RefreshCw, Thermometer, Waves, Activity
} from 'lucide-react';
import { createClient } from '../utils/supabase/client';

interface Event {
  id: number;
  created_at: string;
  source: string;
  level: string;
  message: string;
  value: number;
  threshold: number;
}

// ─── Level badge style ────────────────────────────────────
const getLevelStyle = (level: string) => {
  switch (level?.toLowerCase()) {
    case 'critical': case 'fault': case 'error':
      return {
        bg:    'bg-red-500/10 border-red-500/30',
        text:  'text-red-400',
        icon:  <XCircle className="w-5 h-5 text-red-400" />,
        badge: 'bg-red-500/20 text-red-300',
        label: 'Critical',
      };
    case 'warning': case 'warn':
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

// ─── Source icon ──────────────────────────────────────────
const getSourceIcon = (source: string) => {
  switch (source?.toLowerCase()) {
    case 'temperature':
      return <Thermometer className="w-4 h-4 text-orange-400" />;
    case 'vibration':
      return <Waves className="w-4 h-4 text-blue-400" />;
    default:
      return <Activity className="w-4 h-4 text-gray-400" />;
  }
};

// ─── Source label (capitalize) ────────────────────────────
const formatSource = (source: string) =>
  source.charAt(0).toUpperCase() + source.slice(1).toLowerCase();

export default function Events() {
  const navigate = useNavigate();
  const supabase = createClient();

  const [events, setEvents]     = useState<Event[]>([]);
  const [sources, setSources]   = useState<string[]>([]);   // distinct sources from DB
  const [filter, setFilter]     = useState<string>('all');  // 'all' or a source string
  const [loading, setLoading]   = useState(true);

  // ─── Fetch events + distinct sources ─────────────────
  const fetchEvents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('events')
        .select('id, created_at, source, level, message, value, threshold')
        .order('created_at', { ascending: false })
        .limit(200);

      if (!error && data) {
        const rows = data as Event[];
        setEvents(rows);

        // Extract distinct sources dynamically
        const distinctSources = Array.from(
          new Set(rows.map(e => e.source?.toLowerCase()).filter(Boolean))
        ).sort();
        setSources(distinctSources);
      }
    } catch (err) {
      console.error('Events fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvents(); }, []);

  // ─── Filter logic ─────────────────────────────────────
  // 'all' → show everything
  // 'temperature' / 'vibration' / other → match source
  const filteredEvents = filter === 'all'
    ? events
    : events.filter(e => e.source?.toLowerCase() === filter);

  // ─── Count per source (for badges on filter buttons) ──
  const countFor = (src: string) =>
    src === 'all'
      ? events.length
      : events.filter(e => e.source?.toLowerCase() === src).length;

  // ─── Date formatter ───────────────────────────────────
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    );
  };

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
                {filteredEvents.length} event(s)
                {filter !== 'all' && ` — ${formatSource(filter)}`}
              </p>
            </div>
          </div>
          <button
            onClick={fetchEvents}
            className="p-2 text-gray-400 hover:text-[#FFB84E] transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ─── Filter buttons by SOURCE ─────────────────── */}
      <div className="px-6 pt-4 pb-2 flex flex-wrap gap-2">
        {/* "All" button */}
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center space-x-1 ${
            filter === 'all'
              ? 'bg-[#FFB84E] text-[#262525]'
              : 'bg-[#1a1a1a] text-gray-400 border border-gray-700 hover:border-[#FFB84E]/50'
          }`}
        >
          <span>All</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
            filter === 'all' ? 'bg-[#262525]/30' : 'bg-gray-700'
          }`}>
            {countFor('all')}
          </span>
        </button>

        {/* One button per distinct source */}
        {sources.map(src => (
          <button
            key={src}
            onClick={() => setFilter(src)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center space-x-1 ${
              filter === src
                ? 'bg-[#FFB84E] text-[#262525]'
                : 'bg-[#1a1a1a] text-gray-400 border border-gray-700 hover:border-[#FFB84E]/50'
            }`}
          >
            {getSourceIcon(src)}
            <span>{formatSource(src)}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              filter === src ? 'bg-[#262525]/30' : 'bg-gray-700'
            }`}>
              {countFor(src)}
            </span>
          </button>
        ))}
      </div>

      {/* ─── Events list ─────────────────────────────── */}
      <div className="px-6 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-[#FFB84E] border-t-transparent" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4 opacity-50" />
            <p className="text-gray-400 text-lg font-medium">No events found</p>
            <p className="text-gray-600 text-sm mt-1">
              {filter === 'all'
                ? 'All systems are operating normally'
                : `No events for source "${formatSource(filter)}"`}
            </p>
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
                    {/* Source badge */}
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
                    <span className="text-white font-medium">
                      {Number(event.value).toFixed(2)}
                    </span>
                  </span>
                  <span className="text-gray-500 text-xs">
                    Threshold:{' '}
                    <span className="text-gray-300 font-medium">
                      {Number(event.threshold).toFixed(2)}
                    </span>
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