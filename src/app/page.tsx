'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import AnimatedSphere from '@/components/AnimatedSphere';
import Navbar from '@/components/Navbar';

interface StatsPayload {
  overview: {
    totalUsers: number;
    totalPullers: number;
    onlinePullers: number;
    activeRides: number;
    pendingRequests: number;
    totalRides: number;
    completedRides: number;
  };
}

interface Location {
  id: string;
  name: string;
  blockId: string;
}

export default function Home() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to load stats', error);
      } finally {
        setLoadingStats(false);
      }
    };

    const loadLocations = async () => {
      try {
        const res = await fetch('/api/locations');
        if (res.ok) {
          const data = await res.json();
          setLocations(data.locations || []);
        }
      } catch (error) {
        console.error('Failed to load locations', error);
      }
    };

    loadStats();
    loadLocations();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      <Navbar />

      {/* Main Hero Section */}
      <section id="home" className="pt-20 sm:pt-24 pb-8 sm:pb-12 px-4 sm:px-6 relative min-h-screen flex items-center">
        <div className="container mx-auto max-w-7xl grid lg:grid-cols-2 gap-8 sm:gap-12 items-center">
          {/* Left Side - Content */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-6 sm:space-y-8 z-10 order-2 lg:order-1"
          >
            {/* Subheading */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="text-lg sm:text-xl md:text-2xl text-white font-light"
            >
              Accessible Transportation System
            </motion.p>

            {/* Main Title - Large glowing green */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold text-green-400 leading-tight"
              style={{
                textShadow: '0 0 20px rgba(34, 197, 94, 0.5), 0 0 40px rgba(34, 197, 94, 0.3)',
              }}
            >
              AERAS
            </motion.h1>

            {/* Quote - Italicized with green vertical line indicator */}
            <motion.blockquote
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="text-base sm:text-lg md:text-xl text-white italic pl-4 sm:pl-6 border-l-2 border-green-400/50 max-w-2xl"
            >
              "Stand on a destination block, verify with light, press confirm, and the nearest registered puller is dispatched automatically."
            </motion.blockquote>

            {/* Quick CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.45 }}
              className="flex flex-wrap gap-3"
            >
              <Link
                href="/rickshaw"
                className="px-6 py-3 rounded-full bg-green-500/20 border border-green-400/50 text-green-400 font-semibold hover:bg-green-500/30 transition-colors"
              >
                Rickshaw Portal
              </Link>
              <Link
                href="/admin"
                className="px-6 py-3 rounded-full border border-white/30 text-white font-semibold hover:border-green-400/60 transition-colors"
              >
                Admin Dashboard
              </Link>
            </motion.div>
          </motion.div>

          {/* Right Side - Animated Sphere */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.3 }}
            className="relative h-[400px] sm:h-[500px] md:h-[600px] lg:h-[700px] w-full order-1 lg:order-2"
          >
            <AnimatedSphere />
            {/* Subtle wave pattern at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black via-black/50 to-transparent pointer-events-none" />
          </motion.div>
        </div>

        {/* Background Effects - Subtle green glows */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
          <div className="absolute top-1/4 right-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-green-500/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/4 left-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-teal-500/5 rounded-full blur-3xl"></div>
        </div>
      </section>

      {/* System Snapshot */}
      <section id="snapshot" className="py-12 sm:py-20 px-4 sm:px-6 relative">
        <div className="container mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-white">
              Live System Snapshot
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-400 max-w-4xl mx-auto px-4">
              Puller availability, ride queue, and registered location blocks pulled directly from the backend.
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-6 sm:gap-8">
            <div className="bg-black/50 border border-white/10 rounded-2xl p-6 sm:p-8 hover:border-green-400/50 transition-all">
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-6">Network Status</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Online Pullers', value: stats?.overview.onlinePullers ?? '--' },
                  { label: 'Active Rides', value: stats?.overview.activeRides ?? '--' },
                  { label: 'Pending Requests', value: stats?.overview.pendingRequests ?? '--' },
                  { label: 'Total Rides', value: stats?.overview.totalRides ?? '--' },
                ].map((card) => (
                  <div key={card.label} className="bg-black/40 border border-white/5 rounded-xl p-4">
                    <div className="text-sm text-gray-400 mb-1">{card.label}</div>
                    <div className="text-2xl font-bold text-green-400">{loadingStats ? '...' : card.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-black/50 border border-white/10 rounded-2xl p-6 sm:p-8 hover:border-green-400/50 transition-all">
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-6">Registered Blocks</h3>
              {locations.length === 0 ? (
                <p className="text-gray-400 text-sm">Loading location data...</p>
              ) : (
                <div className="space-y-4">
                  {locations.map((loc) => (
                    <div key={loc.id} className="flex items-center justify-between bg-black/40 border border-white/5 rounded-xl p-4">
                      <div>
                        <p className="text-lg font-semibold text-white">{loc.name}</p>
                        <p className="text-xs uppercase tracking-wide text-gray-500">Block ID · {loc.blockId}</p>
                      </div>
                      <span className="text-green-400 font-semibold text-sm">Ready</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="py-12 sm:py-20 px-4 sm:px-6 relative">
        <div className="container mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-white">
              About AERAS
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-400 max-w-3xl mx-auto px-4">
              An application-less, location-based ride request platform designed for senior citizens (≥60) 
              and special needs individuals. Request rides by simply standing on designated location blocks.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {[
              {
                title: 'App-less Interface',
                description: 'No smartphone required. Users simply stand on designated location blocks to request rides.',
                icon: 'LOC'
              },
              {
                title: 'Multi-Sensor Authentication',
                description: 'Ultrasonic sensors, LDR, and laser verification ensure secure privilege access.',
                icon: 'AUTH'
              },
              {
                title: 'Real-time Coordination',
                description: 'Backend automatically alerts nearest rickshaw pullers for efficient ride matching.',
                icon: 'RT'
              }
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-black/50 border border-white/10 rounded-xl p-5 sm:p-6 hover:border-green-400/50 transition-all"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-green-500/20 flex items-center justify-center mb-4">
                  <span className="text-xs sm:text-sm font-bold text-green-400">{feature.icon}</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold mb-2 text-white">{feature.title}</h3>
                <p className="text-gray-400 text-sm">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 sm:py-20 px-4 sm:px-6 bg-gradient-to-b from-black to-black relative">
        <div className="container mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-white">
              Key Features
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-400 max-w-3xl mx-auto px-4">
              A comprehensive solution designed for accessibility and ease of use
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: 'GPS Verification',
                description: 'Automatic drop-off location verification with point-based reward system.',
                icon: 'GPS'
              },
              {
                title: 'Point Reward System',
                description: 'Incentive-based points for pullers, redeemable for rewards at month end.',
                icon: 'PTS'
              },
              {
                title: 'Admin Dashboard',
                description: 'Complete system monitoring, analytics, and management capabilities.',
                icon: 'ADMIN'
              }
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-black/50 border border-white/10 rounded-xl p-5 sm:p-6 hover:border-green-400/50 transition-all"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-green-500/20 flex items-center justify-center mb-4">
                  <span className="text-xs sm:text-sm font-bold text-green-400">{feature.icon}</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold mb-2 text-white">{feature.title}</h3>
                <p className="text-gray-400 text-sm">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* System Architecture Section */}
      <section id="system" className="py-12 sm:py-20 px-4 sm:px-6 relative">
        <div className="container mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-white">
              System Architecture
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: 'User-Side',
                description: 'Physical location blocks with ultrasonic sensors, LDR, laser verification, LED indicators, and OLED display.',
                icon: 'U',
              },
              {
                title: 'Rickshaw-Side',
                description: 'Web UI for pullers, GPS module for verification, OLED display for navigation, and real-time backend communication.',
                icon: 'R',
              },
              {
                title: 'Backend System',
                description: 'Rider alert distribution, real-time status synchronization, point reward management, and admin dashboard.',
                icon: 'B',
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-black/50 border border-white/10 rounded-xl p-5 sm:p-6 hover:border-green-400/50 transition-all"
              >
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-green-500/20 flex items-center justify-center mb-4">
                  <span className="text-xl sm:text-2xl font-bold text-green-400">{item.icon}</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold mb-2 text-white">{item.title}</h3>
                <p className="text-gray-400 text-sm">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 sm:py-12 px-4 sm:px-6 border-t border-white/10">
        <div className="container mx-auto max-w-7xl">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-green-400 to-teal-500 flex items-center justify-center">
                  <span className="text-base sm:text-xl font-bold text-black">A</span>
                </div>
                <span className="text-lg sm:text-xl font-bold text-green-400">AERAS</span>
              </div>
              <p className="text-gray-400 text-sm">
                Accessible E-Rickshaw Automation System
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-4 text-white text-sm sm:text-base">Quick Links</h3>
              <ul className="space-y-2 text-gray-400 text-sm">
                <li><Link href="/rickshaw" className="hover:text-green-400 transition-colors">Rickshaw Portal</Link></li>
                <li><Link href="/admin" className="hover:text-green-400 transition-colors">Admin Dashboard</Link></li>
                <li><a href="#about" className="hover:text-green-400 transition-colors">About</a></li>
                <li><a href="#features" className="hover:text-green-400 transition-colors">Features</a></li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-4 text-white text-sm sm:text-base">Support</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="mailto:ratul.hasan@g.bracu.ac.bd" className="hover:text-green-400 transition-colors">Contact Support</a></li>
                <li><a href="#" className="hover:text-green-400 transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-green-400 transition-colors">Documentation</a></li>
              </ul>
            </div>
          </div>

          <div className="pt-6 sm:pt-8 border-t border-white/10 text-center text-xs sm:text-sm text-gray-500">
            <p>© 2024 AERAS. All rights reserved.</p>
            <p className="mt-2">Accessible E-Rickshaw Automation System</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
