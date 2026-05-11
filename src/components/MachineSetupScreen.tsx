import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Clock, ArrowRight, Gauge } from 'lucide-react';
import motorLogo from '../imports/MOTOR_(2).png';
import { createClient } from '../utils/supabase/client';

// ─── Supabase encoding ───────────────────────────────────
// motor_config.motor_type    : CNC=0 | Compressor=1 | Pump=2 | Robotic Arm=3
// motor_config.operating_mode: idle=0 | normal=1 | peak=2

const MACHINE_TYPES = [
  { id: 'pump',        value: '2', name: 'Pump',        description: 'Centrifugal & Positive Displacement' },
  { id: 'robotic_arm', value: '3', name: 'Robotic Arm',  description: 'Industrial Robotics' },
  { id: 'compressor',  value: '1', name: 'Compressor',   description: 'Air & Gas Compression' },
  { id: 'cnc',         value: '0', name: 'CNC Machine',  description: 'Computer Numerical Control' },
];

const OPERATING_MODES = [
  { id: 'idle',   value: '0', name: 'Idle',   description: 'Low load, standby operation' },
  { id: 'normal', value: '1', name: 'Normal', description: 'Standard operating conditions' },
  { id: 'peak',   value: '2', name: 'Peak',   description: 'Maximum load, high-demand operation' },
];

// Helper: Supabase value → machine id
const valueToMachineId = (v: string) =>
  MACHINE_TYPES.find(m => m.value === v)?.id ?? '';
const valueTOModeId = (v: string) =>
  OPERATING_MODES.find(m => m.value === v)?.id ?? '';

export default function MachineSetupScreen() {
  const navigate = useNavigate();
  const supabase = createClient();

  const [selectedMachine, setSelectedMachine] = useState('');
  const [operatingMode, setOperatingMode]     = useState('');
  const [hoursSinceMaintenance, setHoursSinceMaintenance] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // ─── Load existing config ─────────────────────────────
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await supabase
          .from('motor_config')
          .select('motor_type, operating_mode, hours_sm')
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          setSelectedMachine(valueToMachineId(data.motor_type ?? ''));
          setOperatingMode(valueTOModeId(data.operating_mode ?? ''));
          setHoursSinceMaintenance(String(data.hours_sm ?? ''));
        }
      } catch {
        // No existing config — keep defaults empty
      }
    };
    fetchConfig();
  }, []);

  // ─── Save to Supabase + navigate ──────────────────────
  const handleSubmit = async () => {
    if (!selectedMachine || !operatingMode || !hoursSinceMaintenance) return;

    setLoading(true);
    setError('');
    try {
      const machine = MACHINE_TYPES.find(m => m.id === selectedMachine)!;
      const mode    = OPERATING_MODES.find(m => m.id === operatingMode)!;

      const { error: dbError } = await supabase
        .from('motor_config')
        .upsert({
          id:             1,
          motor_type:     machine.value,   // "0","1","2","3"
          operating_mode: mode.value,      // "0","1","2"
          hours_sm:       parseInt(hoursSinceMaintenance),
          updated_at:     new Date().toISOString(),
        }, { onConflict: 'id' });

      if (dbError) throw dbError;

      localStorage.setItem('machineConfig', JSON.stringify({
        machineType:           selectedMachine,
        operatingMode,
        hoursSinceMaintenance: parseInt(hoursSinceMaintenance),
      }));

      navigate('/monitoring');
    } catch (err: any) {
      setError('Failed to save configuration. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#262525] flex flex-col px-6 py-8">
      {/* Logo Header */}
      <div className="flex justify-center mb-8">
        <img src={motorLogo} alt="Motor Watch" className="w-48 h-48 object-contain" />
      </div>

      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white mb-2 text-center">Machine Configuration</h2>
          <p className="text-gray-400 text-center">
            Configure your motor parameters to start live monitoring
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Machine Type Selection */}
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 mb-3">
              <Settings className="w-5 h-5 text-[#FFB84E]" />
              <span>Machine Type</span>
            </label>
            <div className="grid grid-cols-1 gap-3">
              {MACHINE_TYPES.map((machine) => (
                <button
                  key={machine.id}
                  onClick={() => setSelectedMachine(machine.id)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    selectedMachine === machine.id
                      ? 'border-[#FFB84E] bg-[#FFB84E]/10'
                      : 'border-gray-700 bg-[#1a1a1a] hover:border-gray-600'
                  }`}
                >
                  <p className="text-white font-medium">{machine.name}</p>
                  <p className="text-gray-500 text-xs mt-1">{machine.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Operating Mode */}
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 mb-3">
              <Gauge className="w-5 h-5 text-[#FFB84E]" />
              <span>Operating Mode</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {OPERATING_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setOperatingMode(mode.id)}
                  className={`p-4 rounded-xl border-2 transition-all text-left ${
                    operatingMode === mode.id
                      ? 'border-[#FFB84E] bg-[#FFB84E]/10'
                      : 'border-gray-700 bg-[#1a1a1a] hover:border-gray-600'
                  }`}
                >
                  <p className="text-white font-medium">{mode.name}</p>
                  <p className="text-gray-500 text-xs mt-1">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Hours Since Maintenance */}
          <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 mb-3">
              <Clock className="w-5 h-5 text-[#FFB84E]" />
              <span>Hours Since Last Maintenance</span>
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="1"
                value={hoursSinceMaintenance}
                onChange={(e) => setHoursSinceMaintenance(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg py-4 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FFB84E] transition-colors text-lg"
                placeholder="Enter hours (e.g., 1200)"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">hours</span>
            </div>
            <p className="text-gray-500 text-xs mt-2">
              Approximate operating hours since the last scheduled maintenance
            </p>
          </div>

          {/* Continue Button */}
          <button
            onClick={handleSubmit}
            disabled={!selectedMachine || !operatingMode || !hoursSinceMaintenance || loading}
            className="w-full bg-[#FFB84E] text-[#262525] font-bold py-4 rounded-lg hover:bg-[#ffa31a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 mt-8"
          >
            <span>{loading ? 'Saving...' : 'Start Monitoring'}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-8 text-center">
          <p className="text-gray-500 text-xs">
            These parameters will be used by our AI models for predictive maintenance analysis
          </p>
        </div>
      </div>
    </div>
  );
}