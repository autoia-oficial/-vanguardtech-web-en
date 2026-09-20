'use client';

import { useEffect, useState } from 'react';
import type { Lead, DashboardStats } from '@/types';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, leadsRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/leads?limit=10&sort=created_at&order=desc'),
        ]);

        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }

        if (leadsRes.ok) {
          const leadsData = await leadsRes.json();
          setLeads(leadsData.data || []);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate border-t-silver rounded-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <div className="mb-12">
        <h1 className="text-4xl font-light mb-2">Vanguard CRM</h1>
        <p className="text-silver">Sales Automation & Lead Management</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {stats && (
          <>
            <StatCard label="Total Leads" value={stats.total_leads} />
            <StatCard label="New Leads" value={stats.new_leads} />
            <StatCard label="Audited" value={stats.audited} />
            <StatCard label="Priority" value={stats.priority_leads} />
            <StatCard label="Contacted" value={stats.contacted} />
            <StatCard label="Replies" value={stats.replies} />
            <StatCard label="Demos" value={stats.demos} />
            <StatCard label="Meetings" value={stats.meetings} />
            <StatCard label="Accepted" value={stats.accepted} />
            <StatCard label="Paid" value={stats.paid} />
            <StatCard label="Live" value={stats.live} />
            <StatCard label="Emails Today" value={stats.emails_today} />
          </>
        )}
      </div>

      {/* Leads Table */}
      <div className="bg-charcoal rounded-lg border border-slate overflow-hidden">
        <div className="p-6 border-b border-slate">
          <h2 className="text-xl font-light">Recent Leads</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate text-silver text-sm font-light">
              <tr>
                <th className="px-6 py-3 text-left">Business</th>
                <th className="px-6 py-3 text-left">Category</th>
                <th className="px-6 py-3 text-left">Location</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Priority</th>
                <th className="px-6 py-3 text-left">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate transition-colors">
                  <td className="px-6 py-4 text-sm">{lead.business_name}</td>
                  <td className="px-6 py-4 text-sm text-silver">{lead.category || '-'}</td>
                  <td className="px-6 py-4 text-sm text-silver">{lead.city || '-'}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className="px-2 py-1 rounded bg-slate text-xs">{lead.status}</span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(lead.priority)}`}>
                      {lead.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium">{lead.score}/100</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-charcoal rounded-lg border border-slate p-6">
      <p className="text-sm text-silver mb-2">{label}</p>
      <p className="text-3xl font-light">{value}</p>
    </div>
  );
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-900 text-red-100';
    case 'high':
      return 'bg-orange-900 text-orange-100';
    case 'medium':
      return 'bg-blue-900 text-blue-100';
    default:
      return 'bg-slate text-silver';
  }
}
