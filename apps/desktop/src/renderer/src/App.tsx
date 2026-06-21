// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../preload/index.d.ts" />
import React, { useEffect, useState } from 'react';
import Settings from './components/Settings';

function App(): JSX.Element {
  const [health, setHealth] = useState<string>('loading...');
  const [activeTab, setActiveTab] = useState<'runs' | 'recipes' | 'schedule' | 'library' | 'settings'>('runs');

  useEffect(() => {
    window.murl
      .engineHealth()
      .then((res: string) => setHealth(res))
      .catch((err: unknown) => setHealth(`Error: ${err}`));
  }, []);

  const isEngineOk = health === 'murl-engine-ok';

  return (
    <div className="flex flex-col h-screen overflow-hidden select-none font-sans text-chalk p-6 gap-6">
      {/* Top Strip */}
      <div className="flex items-center justify-between h-8 border-b border-aluminium/20 pb-3">
        <div className="flex items-baseline gap-3">
          <span className="font-dot text-lg tracking-[0.12em] text-chalk">MURL</span>
          <span className="text-xs uppercase tracking-label font-sans text-aluminium">research harness</span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-aluminium">
          <span>v0.1.0</span>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex flex-1 gap-6 min-h-0">
        {/* Left Sidebar */}
        <div className="w-[180px] flex flex-col justify-between py-2 shrink-0">
          <nav className="flex flex-col gap-5 text-sm font-sans tracking-[0.02em]">
            <a
              href="#runs"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('runs');
              }}
              className={`transition-colors duration-150 flex items-center gap-2 ${
                activeTab === 'runs'
                  ? 'text-chalk font-semibold'
                  : 'text-aluminium hover:text-chalk pl-3.5'
              }`}
            >
              {activeTab === 'runs' && (
                <span className="w-1.5 h-1.5 rounded-full bg-chalk shadow-active"></span>
              )}
              Runs
            </a>
            <a
              href="#recipes"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('recipes');
              }}
              className={`transition-colors duration-150 flex items-center gap-2 ${
                activeTab === 'recipes'
                  ? 'text-chalk font-semibold'
                  : 'text-aluminium hover:text-chalk pl-3.5'
              }`}
            >
              {activeTab === 'recipes' && (
                <span className="w-1.5 h-1.5 rounded-full bg-chalk shadow-active"></span>
              )}
              Recipes
            </a>
            <a
              href="#schedule"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('schedule');
              }}
              className={`transition-colors duration-150 flex items-center gap-2 ${
                activeTab === 'schedule'
                  ? 'text-chalk font-semibold'
                  : 'text-aluminium hover:text-chalk pl-3.5'
              }`}
            >
              {activeTab === 'schedule' && (
                <span className="w-1.5 h-1.5 rounded-full bg-chalk shadow-active"></span>
              )}
              Schedule
            </a>
            <a
              href="#library"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('library');
              }}
              className={`transition-colors duration-150 flex items-center gap-2 ${
                activeTab === 'library'
                  ? 'text-chalk font-semibold'
                  : 'text-aluminium hover:text-chalk pl-3.5'
              }`}
            >
              {activeTab === 'library' && (
                <span className="w-1.5 h-1.5 rounded-full bg-chalk shadow-active"></span>
              )}
              Library
            </a>
          </nav>

          <div className="flex flex-col gap-4">
            <div className="border-t border-aluminium/20 my-2"></div>
            <a
              href="#settings"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('settings');
              }}
              className={`text-sm transition-colors duration-150 flex items-center gap-2 ${
                activeTab === 'settings'
                  ? 'text-chalk font-semibold'
                  : 'text-aluminium hover:text-chalk pl-3.5 font-sans'
              }`}
            >
              {activeTab === 'settings' && (
                <span className="w-1.5 h-1.5 rounded-full bg-chalk shadow-active"></span>
              )}
              Settings
            </a>
          </div>
        </div>

        {/* Main Canvas Pane */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
          {/* Status Row Panel */}
          <div className="panel p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Glowing status dot */}
              <span
                className={`w-2 h-2 rounded-full transition-all duration-500 ${
                  isEngineOk
                    ? 'bg-chalk shadow-active'
                    : 'bg-signal shadow-signal animate-pulse'
                }`}
              ></span>
              <span className="font-dot text-xs tracking-widest text-chalk uppercase mt-0.5">
                {isEngineOk ? 'ENGINE ONLINE' : 'ENGINE OFFLINE'}
              </span>
            </div>
            <div className="text-xs font-mono text-aluminium">
              status: <span className="font-sans text-chalk font-medium">{health}</span>
            </div>
          </div>

          {/* Large frosted main panel */}
          {activeTab === 'settings' ? (
            <Settings />
          ) : (
            <div className="flex-1 panel p-8 flex flex-col items-center justify-center text-center relative overflow-hidden">
              <div className="max-w-md flex flex-col items-center gap-3 z-10">
                <span className="font-dot text-2xl text-aluminium tracking-wider">00</span>
                <p className="text-sm font-sans text-aluminium">
                  No runs active. Pick a recipe or create a new run to begin research.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
