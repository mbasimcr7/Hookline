'use client';

import React, { useState } from 'react';
import { createEndpoint } from '../lib/api';
import type { Endpoint } from '../lib/types';
import { X, Plus, Globe, Check, AlertCircle } from 'lucide-react';

interface CreateEndpointModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (endpoint: Endpoint) => void;
}

export function CreateEndpointModal({ isOpen, onClose, onCreated }: CreateEndpointModalProps) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [eventTypes, setEventTypes] = useState('*');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError('Endpoint URL is required');
      return;
    }

    try {
      setLoading(true);
      const parsedEvents = eventTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const created = await createEndpoint({
        url: url.trim(),
        description: description.trim() || undefined,
        eventTypes: parsedEvents.length > 0 ? parsedEvents : ['*'],
      });

      onCreated(created);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create endpoint');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden font-mono text-xs">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-foreground font-mono">
              Register Webhook Destination
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-foreground bg-slate-800/80 hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-muted-dark uppercase tracking-wider text-[11px] mb-1.5">
              Destination URL <span className="text-rose-400">*</span>
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://receiver:4000/hook or https://api.yourapp.com/webhooks"
              className="w-full bg-slate-950 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-brand-500/60 transition-colors"
            />
            <span className="text-[10px] text-muted-dark mt-1 block">
              In local Docker setup, use <code>http://receiver:4000/hook</code>
            </span>
          </div>

          <div>
            <label className="block text-muted-dark uppercase tracking-wider text-[11px] mb-1.5">
              Description (Optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Production billing service endpoint"
              className="w-full bg-slate-950 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-brand-500/60 transition-colors"
            />
          </div>

          <div>
            <label className="block text-muted-dark uppercase tracking-wider text-[11px] mb-1.5">
              Subscribed Event Types (Comma-separated)
            </label>
            <input
              type="text"
              value={eventTypes}
              onChange={(e) => setEventTypes(e.target.value)}
              placeholder="*, order.created, invoice.paid"
              className="w-full bg-slate-950 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-brand-500/60 transition-colors"
            />
            <span className="text-[10px] text-muted-dark mt-1 block">
              Use <code>*</code> to subscribe to all published events
            </span>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-muted hover:text-foreground bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg font-bold bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-slate-950 transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {loading ? 'Creating...' : 'Create Destination'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
