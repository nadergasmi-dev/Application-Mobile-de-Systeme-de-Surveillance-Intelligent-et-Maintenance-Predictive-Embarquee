import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Clock, ArrowRight, Gauge } from 'lucide-react';
import motorLogo from '../imports/MOTOR_(2).png';

const OPERATING_MODES = [
  { id: 'idle', name: 'Idle', description: 'Low load, standby operation' },
  { id: 'normal', name: 'Normal', description: 'Standard operating conditions' },
  { id: 'peak', name: 'Peak', description: 'Maximum load, high-demand operation' },
];

const MACHINE_TYPES = [
  { id: 'pump', name: 'Pump', description: 'Centrifugal & Positive Displacement' },
  { id: 'robotic_arm', name: 'Robotic Arm', description: 'Industrial Robotics' },
  { id: 'compressor', name: 'Compressor', description: 'Air & Gas Compression' },
  { id: 'cnc', name: 'CNC Machine', description: 'Computer Numerical Control' },
];

export default function MachineSetupScreen() {
  const navigate = useNavigate();
  const [selectedMachine, setSelectedMachine] = useState('');
  const [operatingMode, setOperatingMode] = useState('');
  const [hoursSinceMaintenance, setHoursSinceMaintenance] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (selectedMachine && operatingMode && hoursSinceMaintenance) {
      const config = {
        machineType: selectedMachine,
        operatingMode,
        hoursSinceMaintenance: parseInt(hoursSinceMaintenance)
      };
      localStorage.setItem('machineConfig', JSON.stringify(config));
      navigate('/dashboard');
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
            disabled={!selectedMachine || !operatingMode || !hoursSinceMaintenance}
            className="w-full bg-[#FFB84E] text-[#262525] font-bold py-4 rounded-lg hover:bg-[#ffa31a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 mt-8"
          >
            <span>Start Monitoring</span>
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