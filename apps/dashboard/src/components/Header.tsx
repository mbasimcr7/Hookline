'use client';

import React, { useState, useEffect } from 'react';
import { getApiKey, setApiKey, DEFAULT_API_KEY } from '../lib/api';
import { KeyRound, Radio, ExternalLink, Check, RefreshCw } from 'lucide-react';

interface HeaderProps {
  isLive?: boolean;
  onApiKeyChange?: (newKey: string) => void;
}

export function Header({ isLive = true, onApiKeyChange }: HeaderProps) {
  const [apiKey, setLocalApiKey] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const current = getApiKey();
    setLocalApiKey(current);
    setKeyInput(current);
  }, []);

  const handleSaveKey = () => {
    const cleanKey = keyInput.trim() || DEFAULT_API_KEY;
    setApiKey(cleanKey);
    setLocalApiKey(cleanKey);
    setIsEditing(false);
    if (onApiKeyChange) onApiKeyChange(cleanKey);
  };

  const handleSetDemo = () => {
    setApiKey(DEFAULT_API_KEY);
    setLocalApiKey(DEFAULT_API_KEY);
    setKeyInput(DEFAULT_API_KEY);
    setIsEditing(false);
    if (onApiKeyChange) onApiKeyChange(DEFAULT_API_KEY);
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-background/80 backdrop-blur-md border-b border-border">
      {/* Left: Branding & Status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
            <Radio className="w-4 h-4 text-brand-400" />
          </div>
          <span className="font-mono font-bold tracking-tight text-foreground text-lg">
            HOOKLINE
          </span>
          <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider rounded bg-brand-500/15 text-brand-400 border border-brand-500/30">
            v0.1
          </span>
        </div>

        {/* Live SSE Indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-border text-xs font-mono">
          <span className="relative flex h-2 w-2">
            {isLive ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
            )}
          </span>
          <span className={isLive ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
            {isLive ? 'LIVE SSE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Right: API Key & Quick Dev Links */}
      <div className="flex items-center gap-3">
        {/* Quick Links to Dev tools */}
        <a
          href="http://localhost:4000"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-muted hover:text-foreground bg-card hover:bg-card-hover border border-border rounded-lg transition-colors"
          title="Open Fake Receiver Monitor"
        >
          <span>Mock Receiver :4000</span>
          <ExternalLink className="w-3 h-3 text-muted-dark" />
        </a>

        <a
          href="http://localhost:15672"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-muted hover:text-foreground bg-card hover:bg-card-hover border border-border rounded-lg transition-colors"
          title="Open RabbitMQ Management UI"
        >
          <span>RabbitMQ :15672</span>
          <ExternalLink className="w-3 h-3 text-muted-dark" />
        </a>

        {/* API Key Switcher */}
        <div className="relative">
          {isEditing ? (
            <div className="flex items-center gap-2 bg-card p-1 rounded-lg border border-brand-500/40 shadow-glow">
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="whk_..."
                className="bg-transparent text-xs font-mono text-foreground px-2 py-1 outline-none w-52"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveKey();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
              <button
                onClick={handleSaveKey}
                className="px-2 py-1 text-xs font-mono bg-brand-500 hover:bg-brand-600 text-slate-950 font-bold rounded"
              >
                Save
              </button>
              <button
                onClick={handleSetDemo}
                className="px-2 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
                title="Reset to Demo Tenant Key"
              >
                Demo
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-card hover:bg-card-hover border border-border px-3 py-1.5 rounded-lg transition-colors">
              <KeyRound className="w-3.5 h-3.5 text-brand-400" />
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs font-mono text-muted hover:text-foreground flex items-center gap-2 cursor-pointer"
                title="Click to edit API Key"
              >
                <span>
                  {apiKey.slice(0, 7)}...{apiKey.slice(-6)}
                </span>
                <span className="text-[10px] text-muted-dark underline">Edit</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
