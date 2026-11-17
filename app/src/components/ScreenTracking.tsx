import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router';
import { logScreen } from '../analytics.js';

const SCREENS: [pattern: string, name: string][] = [
  ['/', 'home'],
  ['/privacy', 'privacy'],
  ['/dashboard', 'wall_dashboard'],
  ['/households/:householdId/boards/:boardId', 'board'],
  ['/households/:householdId/boards/:boardId/tasks/:taskId', 'task'],
  ['/households/:householdId/settings', 'settings'],
];

export function ScreenTracking() {
  const { pathname } = useLocation();
  const screen = SCREENS.find(([pattern]) => matchPath(pattern, pathname) !== null)?.[1];

  useEffect(() => {
    if (screen !== undefined) logScreen(screen);
  }, [screen, pathname]);

  return null;
}
