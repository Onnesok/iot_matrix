'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

interface Ride {
  id: string;
  userId: string;
  pickupLocationId: string;
  destinationLocationId: string;
  status: string;
  createdAt: string;
  distanceFromBlock?: number;
  pointsAwarded?: number;
  pickupLatitude?: number;
  pickupLongitude?: number;
  pickupLocation?: Location;
  destinationLocation?: Location;
  acceptedAt?: string;
  completedAt?: string;
}

interface Puller {
  id: string;
  name: string;
  phone: string;
  points: number;
  isOnline: boolean;
  totalRides: number;
}

interface Location {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export default function RickshawPage() {
  const [puller, setPuller] = useState<Puller | null>(null);
  const [pullerId, setPullerId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [notifications, setNotifications] = useState<Ride[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [pointsHistory, setPointsHistory] = useState<any[]>([]);
  const [recentRides, setRecentRides] = useState<Ride[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [stats, setStats] = useState({ todayRides: 0, todayPoints: 0, avgPointsPerRide: 0, lifetimeRides: 0 });
  const [showNotification, setShowNotification] = useState(false);
  const [newRideNotification, setNewRideNotification] = useState<Ride | null>(null);
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null);

  // Restore login state from localStorage on mount
  useEffect(() => {
    const savedPullerId = localStorage.getItem('pullerId');
    if (savedPullerId) {
      setPullerId(savedPullerId);
      // Restore login by fetching puller data
      fetch(`/api/pullers/${savedPullerId}`)
        .then(res => res.json())
        .then(data => {
          if (data.puller) {
            setPuller(data.puller);
            setIsLoggedIn(true);
            setPointsHistory(data.pointsHistory || []);
            // Set online status
            fetch(`/api/pullers/${savedPullerId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isOnline: true })
            });
            // Stats and polling will be handled by the useEffect that depends on isLoggedIn and pullerId
          } else {
            // Invalid saved ID, clear it
            localStorage.removeItem('pullerId');
          }
        })
        .catch(() => {
          // Error fetching, clear saved ID
          localStorage.removeItem('pullerId');
        });
    }
  }, []);

useEffect(() => {
  // Load locations once
  fetch('/api/locations')
    .then(res => res.json())
    .then(data => setLocations(data.locations))
    .catch(() => {});

  const supportsGeolocation =
    typeof window !== 'undefined' && 'geolocation' in navigator;
  const hasSecureContext =
    typeof window !== 'undefined' && window.isSecureContext;

  if (!supportsGeolocation) {
    console.warn('Geolocation is not available in this browser.');
    return;
  }

  if (!hasSecureContext) {
    console.warn('Geolocation requires HTTPS. Location tracking disabled.');
    return;
  }

  let watchId: number | null = null;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setCurrentLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude
      });
    },
    (error) => {
      console.error('Error getting location:', error);
    }
  );

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      setCurrentLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude
      });
    },
    (error) => {
      console.error('Error watching location:', error);
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );

  return () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
  };
}, []);

useEffect(() => {
  if (!isLoggedIn || !pullerId) {
    return;
  }

  const run = () => {
    fetchActiveRequests();
    updateLocation();
    fetchPullerStats();
  };

  run();

  const interval = setInterval(run, 3000);
  return () => clearInterval(interval);
}, [isLoggedIn, pullerId]);

  const fetchActiveRequests = async () => {
    try {
    const res = await fetch('/api/rides?type=active');
    const data = await res.json();
    const newRides = data.rides || [];
      
      // Check for new ride notifications
      if (newRides.length > notifications.length) {
        const newestRide = newRides.find((ride: Ride) => 
          !notifications.find(n => n.id === ride.id)
        );
        if (newestRide) {
          setNewRideNotification(newestRide);
          setShowNotification(true);
          // Play notification sound if available
          if (notificationSoundRef.current) {
            notificationSoundRef.current.play().catch(() => {});
          }
          setTimeout(() => setShowNotification(false), 5000);
        }
      }
      
      setNotifications(newRides);
    } catch (error) {
      console.error('Error fetching requests:', error);
    }
  };

const fetchPullerStats = async (id?: string) => {
  const targetId = id || pullerId;
  if (!targetId) return;
  try {
    const res = await fetch(`/api/pullers/${targetId}`);
    const data = await res.json();
    if (data.puller) {
      setPuller(data.puller);
      setPointsHistory(data.pointsHistory || []);
      setRecentRides(data.recentRides || []);
      
      const fallbackAvg = data.puller.totalRides > 0 ? (data.puller.points / data.puller.totalRides) : 0;

      if (data.stats) {
        setStats({
          todayRides: data.stats.todayRides ?? 0,
          todayPoints: data.stats.todayPoints ?? 0,
          avgPointsPerRide: data.stats.avgPointsPerRide ?? fallbackAvg,
          lifetimeRides: data.stats.lifetimeRides ?? data.puller.totalRides ?? 0
        });
      } else {
        // Fallback calculation using recent points history
        const today = new Date().toDateString();
        const todayHistory = (data.pointsHistory || []).filter((entry: any) => 
          new Date(entry.createdAt).toDateString() === today && entry.type === 'earned'
        );
        const todayPoints = todayHistory.reduce((sum: number, entry: any) => sum + entry.points, 0);
        const todayRides = todayHistory.length;
        
        setStats({
          todayRides,
          todayPoints,
          avgPointsPerRide: fallbackAvg,
          lifetimeRides: data.puller.totalRides ?? 0
        });
      }

      setActiveRide(data.activeRide || null);
      setNotifications(data.pendingRides || []);
    }
  } catch (error) {
    console.error('Error fetching stats:', error);
  }
};

  const updateLocation = async () => {
    if (!currentLocation || !pullerId) return;
    
    try {
      await fetch(`/api/pullers/${pullerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: currentLocation.lat,
          longitude: currentLocation.lng
        })
      });
    } catch (error) {
      console.error('Error updating location:', error);
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  };

  const getDistanceToPickup = (ride: Ride): number | null => {
    if (!currentLocation || !ride.pickupLatitude || !ride.pickupLongitude) return null;
    return calculateDistance(
      currentLocation.lat,
      currentLocation.lng,
      ride.pickupLatitude,
      ride.pickupLongitude
    );
  };

  const handleLogin = async () => {
    if (!pullerId.trim()) {
      alert('Please enter your Puller ID');
      return;
    }
    
    try {
      const res = await fetch(`/api/pullers/${pullerId}`);
      const data = await res.json();
      
      if (data.puller) {
        // Clear admin session when puller logs in
        localStorage.removeItem('adminId');
        
        setPuller(data.puller);
        setIsLoggedIn(true);
        
        // Save to localStorage for persistent login
        localStorage.setItem('pullerId', pullerId);
        
        // Set online status
        await fetch(`/api/pullers/${pullerId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isOnline: true })
        });

        // Load points history and stats
        setPointsHistory(data.pointsHistory || []);
        fetchPullerStats();
        
        // Start polling
        fetchActiveRequests();
      } else {
        alert('Puller not found. Please contact admin to register.');
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Failed to login. Please try again.');
    }
  };

  const handleLogout = async () => {
    if (pullerId) {
      await fetch(`/api/pullers/${pullerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOnline: false })
      });
    }
    // Clear localStorage on logout
    localStorage.removeItem('pullerId');
    setIsLoggedIn(false);
    setPuller(null);
    setPullerId('');
    setActiveRide(null);
    setNotifications([]);
  };

  const handleAccept = async (rideId: string) => {
    try {
      const res = await fetch(`/api/rides/${rideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accept',
          pullerId: pullerId
        })
      });

      const data = await res.json();
      if (data.ride) {
        setActiveRide(data.ride);
        setNotifications(notifications.filter(r => r.id !== rideId));
      }
    } catch (error) {
      console.error('Error accepting ride:', error);
      alert('Failed to accept ride');
    }
  };

  const handleReject = async (rideId: string) => {
    try {
      await fetch(`/api/rides/${rideId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' })
      });
      
      setNotifications(notifications.filter(r => r.id !== rideId));
    } catch (error) {
      console.error('Error rejecting ride:', error);
    }
  };

  const handleConfirmPickup = async () => {
    if (!activeRide) return;

    try {
      const res = await fetch(`/api/rides/${activeRide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_pickup',
          pullerId: pullerId
        })
      });

      const data = await res.json();
      if (data.ride) {
        setActiveRide(data.ride);
      }
    } catch (error) {
      console.error('Error confirming pickup:', error);
      alert('Failed to confirm pickup');
    }
  };

  const handleCompleteRide = async () => {
    if (!activeRide || !currentLocation) {
      alert('GPS location required to complete ride');
      return;
    }

    if (!confirm('Confirm ride completion at current location?')) return;

    try {
      const res = await fetch(`/api/rides/${activeRide.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          pullerId: pullerId,
          latitude: currentLocation.lat,
          longitude: currentLocation.lng
        })
      });

      const data = await res.json();
      if (data.ride) {
        const pointsEarned = data.ride.pointsAwarded || 0;
        alert(`Ride completed successfully! Points earned: ${pointsEarned}`);
        setActiveRide(null);
        
        // Refresh puller data
        fetchPullerStats();
      }
    } catch (error) {
      console.error('Error completing ride:', error);
      alert('Failed to complete ride');
    }
  };

  const getLocationName = (locationId: string) => {
    return locations.find(l => l.id === locationId)?.name || locationId;
  };

  const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
  };

const rideStatusStyles: Record<
  string,
  { label: string; className: string }
> = {
  completed: {
    label: 'Completed',
    className: 'bg-green-500/20 text-green-400 border-green-400/50'
  },
  accepted: {
    label: 'Accepted',
    className: 'bg-blue-500/20 text-blue-300 border-blue-400/50'
  },
  pickup_confirmed: {
    label: 'Pickup Confirmed',
    className: 'bg-amber-500/20 text-amber-300 border-amber-400/50'
  },
  pending: {
    label: 'Pending',
    className: 'bg-white/10 text-white border-white/20'
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-red-500/20 text-red-300 border-red-400/50'
  }
};

const getRideStatusMeta = (status: string) => {
  return (
    rideStatusStyles[status] || {
      label: status.replace(/_/g, ' '),
      className: 'bg-white/10 text-gray-300 border-white/20'
    }
  );
};

const formatRideTimestamp = (ride: Ride) => {
  const time = ride.completedAt || ride.acceptedAt || ride.createdAt;
  return new Date(time).toLocaleString();
};

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navbar />
        <div className="flex items-center justify-center p-4 sm:p-6 pt-24 md:pt-28 min-h-[calc(100vh-80px)]">
          <div className="fixed inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 right-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-green-500/5 rounded-full blur-3xl"></div>
            <div className="absolute bottom-1/4 left-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-teal-500/5 rounded-full blur-3xl"></div>
          </div>
          
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="bg-black/50 border border-white/10 rounded-xl p-6 sm:p-8 max-w-md w-full relative z-10 hover:border-green-400/50 transition-all"
          >
            <div className="text-center mb-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-green-500/20 flex items-center justify-center mx-auto mb-4"
              >
                <span className="text-xl sm:text-2xl font-bold text-green-400">A</span>
              </motion.div>
              <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-white">
                AERAS Portal
              </h1>
              <p className="text-sm sm:text-base text-gray-400">Sign in to start earning</p>
            </div>
            
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  Puller ID or Phone
                </label>
                <input
                  type="text"
                  value={pullerId}
                  onChange={(e) => setPullerId(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Enter ID or phone number"
                  className="w-full px-4 py-3.5 bg-black/50 border border-white/20 rounded-full focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-400/20 transition-all text-sm sm:text-base placeholder-gray-500 text-white"
                  autoFocus
                />
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleLogin}
                className="w-full py-3.5 bg-green-500/20 hover:bg-green-500/30 border border-green-400/50 rounded-full font-semibold transition-all text-green-400 text-sm sm:text-base"
              >
                Sign In
              </motion.button>
              <p className="text-xs sm:text-sm text-gray-500 text-center mt-4">
                Don't have an ID? Contact admin to register
              </p>
              <div className="pt-4 border-t border-white/10">
                <Link href="/" className="text-xs sm:text-sm text-green-400 hover:text-green-300 text-center block transition-colors">
                  Back to Home
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="p-4 md:p-6 pt-24 md:pt-28">
        {/* Notification Toast */}
        <AnimatePresence>
          {showNotification && newRideNotification && (
            <motion.div
              initial={{ opacity: 0, y: -50, x: '-50%', scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 0.9 }}
              className="fixed top-24 md:top-28 left-1/2 transform -translate-x-1/2 z-50 bg-black/90 border border-green-400/50 rounded-xl p-4 sm:p-5 shadow-2xl max-w-md w-[calc(100%-2rem)] sm:w-full mx-4 backdrop-blur-sm"
            >
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm"
                >
                  <span className="text-xl font-bold">!</span>
                </motion.div>
                <div className="flex-1">
                  <div className="font-bold text-lg">New Ride Request!</div>
                  <div className="text-sm opacity-90 mt-1">
                    {getLocationName(newRideNotification.pickupLocationId)} to {getLocationName(newRideNotification.destinationLocationId)}
                  </div>
                </div>
                <button
                  onClick={() => setShowNotification(false)}
                  className="text-white/80 hover:text-white text-2xl font-bold transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
                >
                  ×
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black/50 border border-white/10 rounded-xl p-5 sm:p-7 mb-5 sm:mb-6 hover:border-green-400/50 transition-all"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 sm:gap-5">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-3">
                  <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold truncate text-white">
                    Welcome, {puller?.name}
                  </h1>
                  <motion.div
                    animate={puller?.isOnline ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className={`px-3 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap flex items-center gap-2 ${
                      puller?.isOnline 
                        ? 'bg-green-500/20 text-green-400 border border-green-400/50' 
                        : 'bg-black/50 text-gray-400 border border-white/10'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-current"></span>
                    {puller?.isOnline ? 'Online' : 'Offline'}
                  </motion.div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                  <div className="text-sm text-gray-400 truncate">
                    Phone: {puller?.phone}
                  </div>
                  {currentLocation && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      GPS: {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-4 sm:gap-5">
                <div className="text-right bg-black/50 rounded-xl px-4 py-3 border border-white/10">
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-green-400">
                  {puller?.points || 0}
                </div>
                  <div className="text-xs sm:text-sm text-gray-400 mt-1">Total Points</div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleLogout}
                  className="px-4 sm:px-5 py-2.5 bg-black/50 hover:bg-black/70 rounded-full text-xs sm:text-sm font-semibold transition-all border border-white/20 hover:border-green-400/50 text-white whitespace-nowrap"
                >
                  Logout
                </motion.button>
              </div>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-3 sm:gap-5 mt-6 sm:mt-7 pt-6 sm:pt-7 border-t border-white/10">
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="text-center bg-black/50 rounded-xl p-3 sm:p-4 border border-white/10 hover:border-green-400/50 transition-all"
              >
                <div className="text-2xl sm:text-3xl font-bold text-green-400 mb-1">{stats.todayRides}</div>
                <div className="text-xs sm:text-sm text-gray-400">Today's Rides</div>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="text-center bg-black/50 rounded-xl p-3 sm:p-4 border border-white/10 hover:border-green-400/50 transition-all"
              >
                <div className="text-2xl sm:text-3xl font-bold text-green-400 mb-1">{stats.todayPoints}</div>
                <div className="text-xs sm:text-sm text-gray-400">Today's Points</div>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="text-center bg-black/50 rounded-xl p-3 sm:p-4 border border-white/10 hover:border-green-400/50 transition-all"
              >
                <div className="text-2xl sm:text-3xl font-bold text-green-400 mb-1">{stats.lifetimeRides || 0}</div>
                <div className="text-xs sm:text-sm text-gray-400">Total Rides</div>
              </motion.div>
            </div>
          </motion.div>

          <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-4 sm:space-y-6 order-2 lg:order-1">
              {/* Active Ride Card */}
              {activeRide ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="bg-black/50 border border-white/10 rounded-xl p-6 sm:p-7 hover:border-green-400/50 transition-all"
                >
                  <div className="flex items-center gap-3 mb-5">
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                      className="w-3 h-3 rounded-full bg-green-400"
                    ></motion.div>
                    <h2 className="text-2xl font-bold text-white">
                      Active Ride
                    </h2>
                  </div>
                    
                    <div className="space-y-4">
                      <div className="grid md:grid-cols-2 gap-4">
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          className="bg-black/50 rounded-xl p-5 border border-white/10 hover:border-green-400/50 transition-all"
                        >
                          <div className="text-xs text-gray-400 mb-2">
                            Pickup Location
                          </div>
                          <div className="text-xl font-bold text-white mb-2">{getLocationName(activeRide.pickupLocationId)}</div>
                          {activeRide.pickupLatitude && currentLocation && (
                            <div className="text-sm text-green-400 font-semibold">
                              {formatDistance(getDistanceToPickup(activeRide) || 0)} away
                            </div>
                          )}
                        </motion.div>
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          className="bg-black/50 rounded-xl p-5 border border-white/10 hover:border-green-400/50 transition-all"
                        >
                          <div className="text-xs text-gray-400 mb-2">
                            Destination
                          </div>
                          <div className="text-xl font-bold text-white">{getLocationName(activeRide.destinationLocationId)}</div>
                        </motion.div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 mt-6">
                        {activeRide.status === 'accepted' && (
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleConfirmPickup}
                            className="flex-1 py-3.5 bg-green-500/20 hover:bg-green-500/30 border border-green-400/50 rounded-full font-semibold transition-all text-green-400"
                          >
                            Confirm Pickup
                          </motion.button>
                        )}
                        {activeRide.status === 'pickup_confirmed' && (
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleCompleteRide}
                            className="flex-1 py-3.5 bg-green-500/20 hover:bg-green-500/30 border border-green-400/50 rounded-full font-semibold transition-all text-green-400"
                          >
                            Complete Ride
                          </motion.button>
                        )}
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            if (confirm('Cancel this ride?')) setActiveRide(null);
                          }}
                          className="px-6 py-3.5 bg-black/50 hover:bg-black/70 rounded-full transition-all border border-white/20 hover:border-white/30 text-white"
                        >
                          Cancel
                        </motion.button>
                      </div>
                    </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-black/50 border border-white/10 rounded-xl p-8 sm:p-10 text-center hover:border-green-400/50 transition-all"
                >
                  <h2 className="text-xl sm:text-2xl font-bold mb-2 text-white">No Active Ride</h2>
                  <p className="text-gray-400">Accept a ride request below to get started</p>
                </motion.div>
              )}

              {/* Ride Requests */}
              <div className="bg-black/50 border border-white/10 rounded-xl p-6 sm:p-7 hover:border-green-400/50 transition-all">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-2xl font-bold text-white">
                    Ride Requests
                  </h2>
                  <motion.div
                    animate={{ scale: notifications.length > 0 ? [1, 1.1, 1] : 1 }}
                    className="px-4 py-1.5 bg-green-500/20 text-green-400 rounded-full text-xs sm:text-sm font-semibold border border-green-400/50"
                  >
                    {notifications.length} Active
                  </motion.div>
                </div>
                
                {notifications.length === 0 ? (
                  <div className="text-center py-12 sm:py-16">
                    <div className="w-20 h-20 rounded-full bg-black/50 mx-auto mb-4 flex items-center justify-center border border-white/10">
                      <span className="text-2xl font-bold text-gray-400">!</span>
                    </div>
                    <p className="text-gray-400 text-lg mb-2">No active requests</p>
                    <p className="text-gray-500 text-sm">New requests will appear here automatically</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {notifications.map((ride, index) => {
                      const distance = getDistanceToPickup(ride);
                      return (
                        <motion.div
                          key={ride.id}
                          initial={{ opacity: 0, x: -20, y: 10 }}
                          animate={{ opacity: 1, x: 0, y: 0 }}
                          transition={{ delay: index * 0.1 }}
                          whileHover={{ scale: 1.02, y: -2 }}
                          className="bg-black/50 border border-white/10 rounded-xl p-5 hover:border-green-400/50 transition-all"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-3">
                                <div className="font-bold text-lg sm:text-xl">
                                  {getLocationName(ride.pickupLocationId)} to {getLocationName(ride.destinationLocationId)}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                                <span className="text-gray-400">
                                  {new Date(ride.createdAt).toLocaleTimeString()}
                                </span>
                                {distance !== null && (
                                  <span className="text-green-400 font-semibold">
                                    {formatDistance(distance)} from you
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-3">
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleAccept(ride.id)}
                                className="px-5 py-2.5 bg-green-500/20 hover:bg-green-500/30 border border-green-400/50 rounded-full text-sm font-semibold transition-all text-green-400"
                              >
                                Accept
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => handleReject(ride.id)}
                                className="px-5 py-2.5 bg-black/50 hover:bg-black/70 border border-white/20 hover:border-white/30 rounded-full text-sm font-semibold transition-all text-white"
                              >
                                Reject
                              </motion.button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Rides */}
              <div className="bg-black/50 border border-white/10 rounded-xl p-6 sm:p-7 hover:border-green-400/50 transition-all">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-2xl font-bold text-white">
                    Recent Rides
                  </h2>
                  <span className="text-xs sm:text-sm text-gray-400">
                    Last {Math.min(10, recentRides.length)} rides
                  </span>
                </div>
                {recentRides.length === 0 ? (
                  <div className="text-center py-10">
                    <p className="text-gray-400 text-sm">No rides completed yet</p>
                    <p className="text-gray-500 text-xs mt-2">Your completed rides will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentRides.map((ride, index) => {
                      const statusMeta = getRideStatusMeta(ride.status);
                      const pickupName = ride.pickupLocation?.name || getLocationName(ride.pickupLocationId);
                      const destinationName = ride.destinationLocation?.name || getLocationName(ride.destinationLocationId);
                      return (
                        <motion.div
                          key={ride.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="bg-black/40 border border-white/10 rounded-xl p-4 sm:p-5 hover:border-green-400/50 transition-all"
                        >
                          <div className="flex flex-wrap items-center gap-3 justify-between">
                            <div className="font-semibold text-base sm:text-lg text-white">
                              {pickupName} → {destinationName}
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-400">
                            <span>{formatRideTimestamp(ride)}</span>
                            <span className="text-green-400 font-semibold">
                              {ride.pointsAwarded !== undefined && ride.pointsAwarded !== null
                                ? `+${ride.pointsAwarded} pts`
                                : 'Points pending'}
                            </span>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4 sm:space-y-6 order-1 lg:order-2">
              {/* Points History */}
              <div className="bg-black/50 border border-white/10 rounded-xl p-6 hover:border-green-400/50 transition-all">
                <h2 className="text-xl sm:text-2xl font-bold mb-5 text-white">
                  Points History
                </h2>
                <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                  {pointsHistory.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-400 text-sm">No history yet</p>
                      <p className="text-gray-500 text-xs mt-2">Complete rides to earn points</p>
                    </div>
                  ) : (
                    pointsHistory.slice(0, 15).map((entry, index) => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="bg-black/50 rounded-xl p-4 text-sm border border-white/10 hover:border-green-400/50 transition-all"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className={`font-bold text-base ${
                            entry.type === 'earned' 
                              ? 'text-green-400' 
                              : entry.type === 'adjusted' 
                              ? 'text-teal-400' 
                              : 'text-gray-400'
                          }`}>
                            {entry.type === 'earned' ? '+' : entry.type === 'adjusted' ? '±' : '-'}{entry.points} pts
                          </span>
                          <span className="text-gray-500 text-xs">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="text-gray-400 text-xs mt-1">{entry.description}</div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick Stats */}
              <div className="bg-black/50 border border-white/10 rounded-xl p-6 hover:border-green-400/50 transition-all">
                <h2 className="text-xl sm:text-2xl font-bold mb-5 text-white">
                  Quick Stats
                </h2>
                <div className="space-y-4">
                  <motion.div
                    whileHover={{ scale: 1.02, x: 5 }}
                    className="flex justify-between items-center p-3 bg-black/50 rounded-xl border border-white/10 hover:border-green-400/50 transition-all"
                  >
                    <span className="text-gray-400 text-sm">
                      Total Points
                    </span>
                    <span className="font-bold text-lg text-green-400">{puller?.points || 0}</span>
                  </motion.div>
                  <motion.div
                    whileHover={{ scale: 1.02, x: 5 }}
                    className="flex justify-between items-center p-3 bg-black/50 rounded-xl border border-white/10 hover:border-green-400/50 transition-all"
                  >
                    <span className="text-gray-400 text-sm">
                      Total Rides
                    </span>
                    <span className="font-bold text-lg text-green-400">{stats.lifetimeRides || 0}</span>
                  </motion.div>
                  <motion.div
                    whileHover={{ scale: 1.02, x: 5 }}
                    className="flex justify-between items-center p-3 bg-black/50 rounded-xl border border-white/10 hover:border-green-400/50 transition-all"
                  >
                    <span className="text-gray-400 text-sm">
                      Avg Points/Ride
                    </span>
                    <span className="font-bold text-lg text-green-400">
                      {Number(stats.avgPointsPerRide || 0).toFixed(1)}
                    </span>
                  </motion.div>
                </div>
              </div>

              {/* Navigation */}
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="bg-black/50 border border-white/10 rounded-xl p-6 hover:border-green-400/50 transition-all"
              >
                <Link href="/" className="text-green-400 hover:text-green-300 text-sm font-semibold block text-center transition-colors">
                  Back to Home
                </Link>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Hidden audio element for notifications */}
        <audio ref={notificationSoundRef} preload="auto">
          <source src="/notification.mp3" type="audio/mpeg" />
        </audio>
      </div>
    </div>
  );
}

