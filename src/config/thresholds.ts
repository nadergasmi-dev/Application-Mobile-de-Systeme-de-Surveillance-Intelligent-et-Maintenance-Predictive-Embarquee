export interface ThresholdLevel {
  warn: number;
  alarm: number;
}

export interface ThresholdSet {
  temperature: ThresholdLevel;
  vibration: ThresholdLevel;
}

export const MACHINE_THRESHOLDS: Record<'cnc' | 'compressor' | 'pump' | 'robotic_arm', ThresholdSet> = {
  cnc: {
    temperature: { warn: 80, alarm: 100 },
    vibration:   { warn: 4.5, alarm: 7.1 },
  },
  robotic_arm: {
    temperature: { warn: 75, alarm: 90 },
    vibration:   { warn: 3.5, alarm: 6.0 },
  },
  pump: {
    temperature: { warn: 70, alarm: 85 },
    vibration:   { warn: 4.5, alarm: 7.1 },
  },
  compressor: {
    temperature: { warn: 90, alarm: 110 },
    vibration:   { warn: 7.1, alarm: 11.2 },
  },
};

const MACHINE_TYPE_MAP: Record<string, keyof typeof MACHINE_THRESHOLDS> = {
  '0': 'cnc',
  '1': 'compressor',
  '2': 'pump',
  '3': 'robotic_arm',
  cnc: 'cnc',
  compressor: 'compressor',
  pump: 'pump',
  robotic_arm: 'robotic_arm',
};

const DEFAULT_MACHINE_TYPE: keyof typeof MACHINE_THRESHOLDS = 'cnc';

export const DEFAULT_THRESHOLDS = MACHINE_THRESHOLDS[DEFAULT_MACHINE_TYPE];

export function resolveMachineType(value?: string): keyof typeof MACHINE_THRESHOLDS {
  return MACHINE_TYPE_MAP[value ?? ''] ?? DEFAULT_MACHINE_TYPE;
}

export function getThresholds(machineType?: string): ThresholdSet {
  return MACHINE_THRESHOLDS[resolveMachineType(machineType)];
}
