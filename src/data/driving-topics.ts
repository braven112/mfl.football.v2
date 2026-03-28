import type { DrivingTopic } from '../types/driving-chat';

export const DRIVING_TOPICS: DrivingTopic[] = [
  {
    id: 'signs',
    label: 'Road Signs',
    icon: '🪧',
    description: 'Regulatory, warning, and guide signs — shapes, colors, and meanings',
  },
  {
    id: 'right-of-way',
    label: 'Right of Way',
    icon: '🚦',
    description: 'Who goes first at intersections, roundabouts, and uncontrolled crossings',
  },
  {
    id: 'speed-limits',
    label: 'Speed Limits',
    icon: '⚡',
    description: 'Default speeds, school zones, residential areas, and highways',
  },
  {
    id: 'parking',
    label: 'Parking',
    icon: '🅿️',
    description: 'Parallel parking, hill parking, no-parking zones, and curb colors',
  },
  {
    id: 'intersections',
    label: 'Intersections & Turns',
    icon: '↩️',
    description: 'Left turns, right turns, U-turns, protected vs unprotected turns',
  },
  {
    id: 'lane-usage',
    label: 'Lanes & Passing',
    icon: '🛣️',
    description: 'Lane changes, HOV lanes, passing rules, and lane markings',
  },
  {
    id: 'sharing-road',
    label: 'Sharing the Road',
    icon: '🚲',
    description: 'Pedestrians, bicyclists, motorcycles, school buses, and large trucks',
  },
  {
    id: 'impaired-driving',
    label: 'Impaired Driving',
    icon: '🚫',
    description: 'DUI laws, BAC limits, implied consent, and consequences',
  },
  {
    id: 'driving-techniques',
    label: 'Driving Techniques',
    icon: '🎯',
    description: 'Steering, braking, acceleration, blind spots, and defensive driving',
  },
  {
    id: 'weather-conditions',
    label: 'Weather & Hazards',
    icon: '🌧️',
    description: 'Rain, snow, fog, hydroplaning, and emergency situations',
  },
  {
    id: 'licensing',
    label: 'Licensing & Permits',
    icon: '📋',
    description: 'Instruction permits, intermediate licenses, age requirements, and renewals',
  },
  {
    id: 'insurance-vehicle',
    label: 'Insurance & Vehicle',
    icon: '🚗',
    description: 'Required insurance, vehicle equipment, seat belts, and child restraints',
  },
  {
    id: 'drive-test',
    label: 'Drive Test Prep',
    icon: '✅',
    description: 'Pre-drive checklist, common mistakes, automatic failures, and test tips',
  },
];
