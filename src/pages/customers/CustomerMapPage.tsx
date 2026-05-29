import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Search,
  Navigation,
  Compass,
  ChevronRight,
  ChevronLeft,
  X,
  RefreshCw,
  Send,
  Eye,
  CheckCircle
} from 'lucide-react'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

// Bổ sung kiểu khai báo cho thư viện Leaflet tải động
declare const L: any;

interface Customer {
  id: string
  code: string
  farm_name: string
  customer_type: string
  value_tier: string
  province: string | null
  district: string | null
  address: string | null
  gps_lat: number | null
  gps_lng: number | null
  owner_user_id: string
  credit_limit: number
  is_active: boolean
  owner: {
    full_name: string
    email: string
  } | null
  farms?: Farm[]
}

interface Farm {
  id: string
  customer_id: string
  name: string
  address: string | null
  area_sqm: number | null
  capacity_heads: number | null
  notes: string | null
  gps_lat: number | null
  gps_lng: number | null
}

interface Employee {
  id: string
  full_name: string
  email: string
  avatar_url: string | null
  last_lat?: number
  last_lng?: number
  last_recorded_at?: string
}

interface LocationHistory {
  gps_lat: number
  gps_lng: number
  recorded_at: string
}

// Calculate distance using Haversine formula
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371 // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const CUSTOMER_TYPE_COLORS: Record<string, string> = {
  farm_household: '#10b981',   // emerald
  farm_commercial: '#3b82f6',  // blue
  dealer: '#f59e0b',           // orange
  enterprise: '#8b5cf6',       // purple
  vet_clinic: '#ec4899',       // pink
  other: '#6b7280'             // gray
}

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  farm_household: 'Hộ chăn nuôi',
  farm_commercial: 'Trang trại lớn',
  dealer: 'Đại lý',
  enterprise: 'Doanh nghiệp',
  vet_clinic: 'Phòng khám',
  other: 'Khác'
}

export default function CustomerMapPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const focusParam = searchParams.get('focus')

  // Map state
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const [leafletLoaded, setLeafletLoaded] = useState(false)
  const [leafletError, setLeafletError] = useState(false)

  // Data state
  const [customers, setCustomers] = useState<Customer[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Geolocation & center point states
  const [myLocation, setMyLocation] = useState<[number, number] | null>(null)
  const [centerPoint, setCenterPoint] = useState<{
    lat: number
    lng: number
    label: string
    type: 'mylocation' | 'customer' | 'farm' | 'default'
    id?: string
  } | null>(null)

  // Filter States
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedRep, setSelectedRep] = useState('all')
  const [selectedProvince, setSelectedProvince] = useState('all')
  const [selectedDistrict, setSelectedDistrict] = useState('all')
  
  // Radius filter states
  const [radiusKm, setRadiusKm] = useState<number>(15)
  const [enableRadiusFilter, setEnableRadiusFilter] = useState(false)

  // Tracking sales representative states
  const [selectedTrackingRepId, setSelectedTrackingRepId] = useState('')
  const [trackingDate, setTrackingDate] = useState(new Date().toISOString().split('T')[0])
  const [locationHistory, setLocationHistory] = useState<LocationHistory[]>([])
  const [isAutoReporting, setIsAutoReporting] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Leaflet elements caches
  const markersGroupRef = useRef<any>(null)
  const radiusCircleRef = useRef<any>(null)
  const routingLineRef = useRef<any>(null)
  const routeMarkersGroupRef = useRef<any>(null)

  // Unique list of provinces and districts from customers
  const provinces = Array.from(new Set(customers.map(c => c.province).filter(Boolean)))
  const districts = Array.from(
    new Set(
      customers
        .filter(c => selectedProvince === 'all' || c.province === selectedProvince)
        .map(c => c.district)
        .filter(Boolean)
    )
  )

  // 1. Dynamic script loader for Leaflet
  useEffect(() => {
    // Check if Leaflet is already loaded globally
    if (typeof L !== 'undefined') {
      setLeafletLoaded(true)
      return
    }

    // Load stylesheet
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    link.id = 'leaflet-css'
    document.head.appendChild(link)

    // Load script
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.id = 'leaflet-js'
    script.async = true
    script.onload = () => {
      setLeafletLoaded(true)
    }
    script.onerror = () => {
      setLeafletError(true)
    }
    document.body.appendChild(script)

    return () => {
      // Cleanup loaded tags if necessary
    }
  }, [])

  // 2. Fetch customers and barns
  useEffect(() => {
    const fetchData = async () => {
      setLoadingData(true)
      try {
        // Fetch customers
        const { data: custsData, error: custsErr } = await supabase
          .from('customers')
          .select(`
            *,
            owner:profiles!owner_user_id(id, full_name, email)
          `)
          .eq('is_active', true)
        
        if (custsErr) throw custsErr

        // Fetch all farms
        const { data: farmsData, error: farmsErr } = await supabase
          .from('farms')
          .select('*')
        
        if (farmsErr) throw farmsErr

        // Associate farms with customers
        const mappedCustomers = (custsData || []).map((c: any) => {
          const associatedFarms = (farmsData || []).filter(f => f.customer_id === c.id)
          return {
            ...c,
            farms: associatedFarms
          }
        })

        setCustomers(mappedCustomers as unknown as Customer[])

        // Fetch sales team / employees
        const { data: profilesData, error: profilesErr } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url')
          .eq('is_active', true)

        if (profilesErr) throw profilesErr

        // Fetch latest location of each employee
        const { data: locsData, error: locsErr } = await supabase
          .from('employee_locations')
          .select('*')
          .order('recorded_at', { ascending: false })

        if (locsErr) throw locsErr

        // Map latest location to profiles
        const mappedEmployees = (profilesData || []).map((p: any) => {
          const latestLoc = (locsData || []).find(l => l.employee_id === p.id)
          return {
            ...p,
            last_lat: latestLoc?.gps_lat,
            last_lng: latestLoc?.gps_lng,
            last_recorded_at: latestLoc?.recorded_at
          }
        })

        setEmployees(mappedEmployees)

      } catch (err) {
        console.error('Error fetching map data:', err)
      } finally {
        setLoadingData(false)
      }
    }

    fetchData()
  }, [])

  // Get current device geolocation on page load
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords: [number, number] = [position.coords.latitude, position.coords.longitude]
          setMyLocation(coords)
          setCenterPoint({
            lat: coords[0],
            lng: coords[1],
            label: 'Vị trí của bạn',
            type: 'mylocation'
          })
        },
        (error) => {
          console.warn('Geolocation access denied or failed:', error)
          // Default to Binh Dinh center if user blocks geolocation
          setCenterPoint({
            lat: 14.3725,
            lng: 108.9958,
            label: 'Hoài An, Bình Định',
            type: 'default'
          })
        }
      )
    } else {
      setCenterPoint({
        lat: 14.3725,
        lng: 108.9958,
        label: 'Hoài An, Bình Định',
        type: 'default'
      })
    }
  }, [])

  // Auto-reporting location handler
  useEffect(() => {
    if (!isAutoReporting || !profile) return

    const reportLocation = async () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          const lat = position.coords.latitude
          const lng = position.coords.longitude
          try {
            await supabase.from('employee_locations').insert({
              employee_id: profile.id,
              gps_lat: lat,
              gps_lng: lng
            })
            // Update local state to show current marker immediately
            setEmployees(prev => prev.map(emp => {
              if (emp.id === profile.id) {
                return {
                  ...emp,
                  last_lat: lat,
                  last_lng: lng,
                  last_recorded_at: new Date().toISOString()
                }
              }
              return emp
            }))
          } catch (err) {
            console.error('Auto report position failed:', err)
          }
        })
      }
    }

    // Report immediately and then every 1 minute
    reportLocation()
    const interval = setInterval(reportLocation, 60000)

    return () => clearInterval(interval)
  }, [isAutoReporting, profile])

  const hasCenterPoint = centerPoint !== null

  // 3. Initialize Leaflet Map
  useEffect(() => {
    if (!leafletLoaded || !mapContainerRef.current || mapInstanceRef.current || !centerPoint) return

    // Create Leaflet Map Instance
    const map = L.map(mapContainerRef.current, {
      zoomControl: false // custom zoom control position
    }).setView([centerPoint.lat, centerPoint.lng], 10)

    // Load OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map)

    // Add custom zoom control at top-left
    L.control.zoom({ position: 'topleft' }).addTo(map)

    // Add Layer Groups
    markersGroupRef.current = L.layerGroup().addTo(map)
    routeMarkersGroupRef.current = L.layerGroup().addTo(map)

    mapInstanceRef.current = map

    return () => {
      // Cleanup map on unmount
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletLoaded, hasCenterPoint])

  // Filter items logic
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchesSearch =
        c.farm_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.address && c.address.toLowerCase().includes(searchTerm.toLowerCase()))

      const matchesType = selectedType === 'all' || c.customer_type === selectedType
      const matchesRep = selectedRep === 'all' || c.owner_user_id === selectedRep
      const matchesProvince = selectedProvince === 'all' || c.province === selectedProvince
      const matchesDistrict = selectedDistrict === 'all' || c.district === selectedDistrict

      // Distance radius filter
      let matchesRadius = true
      if (enableRadiusFilter && centerPoint) {
        if (c.gps_lat && c.gps_lng) {
          const dist = calculateDistance(centerPoint.lat, centerPoint.lng, c.gps_lat, c.gps_lng)
          matchesRadius = dist <= radiusKm
        } else {
          matchesRadius = false // exclude items without GPS coordinates if radius filter active
        }
      }

      return matchesSearch && matchesType && matchesRep && matchesProvince && matchesDistrict && matchesRadius
    })
  }, [customers, searchTerm, selectedType, selectedRep, selectedProvince, selectedDistrict, enableRadiusFilter, centerPoint, radiusKm])

  // List of filtered farms (from filtered customers)
  const filteredFarms = useMemo(() => {
    const list: Array<Farm & { customerName: string }> = []
    filteredCustomers.forEach(cust => {
      if (cust.farms && cust.farms.length > 0) {
        cust.farms.forEach(f => {
          let matchesRadius = true
          if (enableRadiusFilter && centerPoint) {
            if (f.gps_lat && f.gps_lng) {
              const dist = calculateDistance(centerPoint.lat, centerPoint.lng, f.gps_lat, f.gps_lng)
              matchesRadius = dist <= radiusKm
            } else {
              matchesRadius = false
            }
          }
          if (matchesRadius) {
            list.push({
              ...f,
              customerName: cust.farm_name
            })
          }
        })
      }
    })
    return list
  }, [filteredCustomers, enableRadiusFilter, centerPoint, radiusKm])

  // Create list of customer and farm display items sorted by distance from center point (if set)
  const sortedDistanceItems = useMemo(() => {
    return [
      ...filteredCustomers
        .filter(c => c.gps_lat && c.gps_lng)
        .map(c => ({
          id: c.id,
          name: c.farm_name,
          code: c.code,
          type: 'customer' as const,
          typeLabel: CUSTOMER_TYPE_LABELS[c.customer_type] || 'Khách hàng',
          lat: c.gps_lat!,
          lng: c.gps_lng!,
          address: c.address,
          distance: centerPoint
            ? calculateDistance(centerPoint.lat, centerPoint.lng, c.gps_lat!, c.gps_lng!)
            : 0
        })),
      ...filteredFarms
        .filter(f => f.gps_lat && f.gps_lng)
        .map(f => ({
          id: f.id,
          name: `${f.name} (${f.customerName})`,
          code: 'Chuồng trại',
          type: 'farm' as const,
          typeLabel: 'Chuồng nuôi',
          lat: f.gps_lat!,
          lng: f.gps_lng!,
          address: f.address,
          distance: centerPoint
            ? calculateDistance(centerPoint.lat, centerPoint.lng, f.gps_lat!, f.gps_lng!)
            : 0
        }))
    ].sort((a, b) => a.distance - b.distance)
  }, [filteredCustomers, filteredFarms, centerPoint])

  // 4. Update Map Markers when data or filters change
  useEffect(() => {
    if (!leafletLoaded || !mapInstanceRef.current || !markersGroupRef.current) return

    const map = mapInstanceRef.current
    const markersGroup = markersGroupRef.current

    // Clear existing markers
    markersGroup.clearLayers()

    // 4.1 Render my location marker (if Geolocation enabled)
    if (myLocation) {
      const myIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <span class="animate-ping absolute inline-flex h-6 w-6 rounded-full bg-blue-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-4.5 w-4.5 bg-blue-600 border-2 border-white shadow"></span>
          </div>
        `,
        className: 'custom-myloc-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })

      L.marker(myLocation, { icon: myIcon })
        .addTo(markersGroup)
        .bindPopup(`
          <div class="font-sans text-body-md p-1">
            <p class="font-bold text-gray-700">Vị trí của bạn</p>
            <p class="text-tiny text-gray-400 mt-0.5">Lấy theo GPS thiết bị của bạn</p>
          </div>
        `)
    }

    // 4.2 Render center point marker (if custom customer or farm selected)
    if (centerPoint && centerPoint.type !== 'mylocation') {
      const centerIcon = L.divIcon({
        html: `
          <div class="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-500 border-2 border-red-500 animate-bounce">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        `,
        className: 'custom-center-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      })

      L.marker([centerPoint.lat, centerPoint.lng], { icon: centerIcon })
        .addTo(markersGroup)
        .bindPopup(`
          <div class="font-sans text-body-md p-1">
            <span class="px-2 py-0.5 bg-red-50 text-red-650 font-bold text-[9px] rounded uppercase">Tâm đo</span>
            <p class="font-bold text-gray-800 mt-1">${centerPoint.label}</p>
          </div>
        `)
    }

    // 4.3 Draw Radius circle
    if (radiusCircleRef.current) {
      map.removeLayer(radiusCircleRef.current)
      radiusCircleRef.current = null
    }

    if (enableRadiusFilter && centerPoint) {
      radiusCircleRef.current = L.circle([centerPoint.lat, centerPoint.lng], {
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        radius: radiusKm * 1000 // Convert km to meters
      }).addTo(map)
    }

    // 4.4 Render Customer Markers
    filteredCustomers.forEach(c => {
      if (!c.gps_lat || !c.gps_lng) return

      // Color based on type
      const color = CUSTOMER_TYPE_COLORS[c.customer_type] || '#6b7280'
      const border = c.value_tier === 'vip' ? 'border-amber-400 border-[3px] scale-110 shadow-lg' : 'border-white border-2'

      const custIcon = L.divIcon({
        html: `
          <div class="flex items-center justify-center w-7 h-7 rounded-full text-white ${border} font-bold text-[10px] shadow transition-all hover:scale-110" style="background-color: ${color}">
            ${c.farm_name.charAt(0).toUpperCase()}
          </div>
        `,
        className: 'custom-customer-icon',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })

      const popupContent = `
        <div class="font-sans text-body-md p-1 min-w-[220px]">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-[9px] uppercase px-1.5 py-0.5 rounded text-white" style="background-color: ${color}">
              ${CUSTOMER_TYPE_LABELS[c.customer_type] || 'Khách hàng'}
            </span>
            ${c.value_tier === 'vip' ? '<span class="bg-amber-100 text-amber-700 font-extrabold text-[9px] px-1 rounded uppercase">★ VIP</span>' : ''}
          </div>
          <p class="font-bold text-gray-800 text-body-md mt-1.5">${c.farm_name}</p>
          <p class="text-tiny text-gray-400 font-mono">${c.code}</p>
          
          <div class="mt-2 space-y-1 text-tiny text-gray-500 border-t border-gray-100 pt-2">
            <p><strong>Người phụ trách:</strong> ${c.owner?.full_name || 'Chưa gán'}</p>
            <p><strong>Công nợ:</strong> <span class="font-semibold text-danger-500">${c.credit_limit > 0 ? 'Có nợ' : '0 ₫'}</span></p>
            <p class="truncate"><strong>Địa chỉ:</strong> ${c.address || 'Chưa cập nhật'}</p>
          </div>

          <div class="flex gap-2 mt-3 pt-2 border-t border-gray-100">
            <button onclick="window.setMapCenterPoint(${c.gps_lat}, ${c.gps_lng}, '${c.farm_name.replace(/'/g, "\\'")}', 'customer', '${c.id}')" class="flex-1 text-[11px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 py-1 rounded transition-colors text-center">
              Đo từ đây
            </button>
            <button onclick="window.viewCustomerDetail('${c.id}')" class="flex-1 text-[11px] font-bold bg-gray-50 text-gray-700 hover:bg-gray-150 py-1 rounded transition-colors text-center">
              Xem hồ sơ
            </button>
          </div>
        </div>
      `

      L.marker([c.gps_lat, c.gps_lng], { icon: custIcon })
        .addTo(markersGroup)
        .bindPopup(popupContent)
    })

    // 4.5 Render Barns (Farms) Markers
    filteredFarms.forEach(f => {
      if (!f.gps_lat || !f.gps_lng) return

      const farmIcon = L.divIcon({
        html: `
          <div class="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white border-2 border-white font-bold text-[10px] shadow transition-all hover:scale-110">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
        `,
        className: 'custom-farm-icon',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })

      const popupContent = `
        <div class="font-sans text-body-md p-1 min-w-[200px]">
          <span class="font-bold text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
            Chuồng nuôi
          </span>
          <p class="font-bold text-gray-800 text-body-md mt-1.5">${f.name}</p>
          <p class="text-tiny text-gray-400">Trang trại chủ: <strong class="text-gray-600">${f.customerName}</strong></p>
          
          <div class="mt-2 space-y-1 text-tiny text-gray-500 border-t border-gray-100 pt-2">
            <p><strong>Địa chỉ chuồng:</strong> ${f.address || 'Chưa ghi nhận'}</p>
            <p><strong>Quy mô sức chứa:</strong> ${f.capacity_heads || 'N/A'} con</p>
            <p><strong>Diện tích:</strong> ${f.area_sqm || 'N/A'} m²</p>
          </div>

          <div class="flex gap-2 mt-3 pt-2 border-t border-gray-100">
            <button onclick="window.setMapCenterPoint(${f.gps_lat}, ${f.gps_lng}, '${f.name.replace(/'/g, "\\'")}', 'farm', '${f.id}')" class="flex-1 text-[11px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 py-1 rounded transition-colors text-center">
              Đo từ đây
            </button>
            <button onclick="window.viewCustomerDetail('${f.customer_id}')" class="flex-1 text-[11px] font-bold bg-gray-50 text-gray-700 hover:bg-gray-150 py-1 rounded transition-colors text-center">
              Xem chủ trại
            </button>
          </div>
        </div>
      `

      L.marker([f.gps_lat, f.gps_lng], { icon: farmIcon })
        .addTo(markersGroup)
        .bindPopup(popupContent)
    })

    // 4.6 Render Employees (Sales reps) Markers
    employees.forEach(emp => {
      if (!emp.last_lat || !emp.last_lng) return

      const timeAgo = emp.last_recorded_at
        ? new Date(emp.last_recorded_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        : ''

      const empIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-orange-400 opacity-60"></span>
            <div class="w-8 h-8 rounded-full bg-orange-500 border-2 border-white flex items-center justify-center shadow text-white font-black text-[10px] relative">
              ${emp.avatar_url ? `<img src="${emp.avatar_url}" class="w-full h-full rounded-full object-cover"/>` : emp.full_name.charAt(0).toUpperCase()}
            </div>
          </div>
        `,
        className: 'custom-emp-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })

      const popupContent = `
        <div class="font-sans text-body-md p-1 min-w-[200px]">
          <span class="font-bold text-[9px] uppercase px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-100">
            Nhân viên kinh doanh
          </span>
          <p class="font-bold text-gray-800 text-body-md mt-1.5">${emp.full_name}</p>
          <p class="text-tiny text-gray-400">${emp.email}</p>
          
          <div class="mt-2 space-y-1 text-tiny text-gray-500 border-t border-gray-100 pt-2">
            <p><strong>Vị trí cập nhật:</strong> ${emp.last_lat.toFixed(6)}, ${emp.last_lng.toFixed(6)}</p>
            <p><strong>Thời gian:</strong> ${timeAgo || 'Vừa xong'}</p>
          </div>

          <button onclick="window.viewEmployeeRoute('${emp.id}')" class="w-full mt-3 text-[11px] font-bold bg-orange-50 text-orange-700 hover:bg-orange-100 py-1.5 rounded transition-colors text-center flex items-center justify-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="w-3.5 h-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Xem lộ trình trong ngày
          </button>
        </div>
      `

      L.marker([emp.last_lat, emp.last_lng], { icon: empIcon })
        .addTo(markersGroup)
        .bindPopup(popupContent)
    })

    // Expose window functions for Popups
    window.setMapCenterPoint = (lat: number, lng: number, label: string, type: 'mylocation' | 'customer' | 'farm' | 'default', targetId: string) => {
      setCenterPoint({ lat, lng, label, type, id: targetId })
      map.setView([lat, lng], 13)
    }

    window.viewEmployeeRoute = (employeeId: string) => {
      setSelectedTrackingRepId(employeeId)
      // Open sidebar and trigger search
      setSidebarOpen(true)
      const tabBtn = document.getElementById('tab-btn-tracking')
      if (tabBtn) tabBtn.click()
    }

  }, [leafletLoaded, filteredCustomers, filteredFarms, employees, myLocation, centerPoint, enableRadiusFilter, radiusKm, navigate])

  // 5. Handle Focus parameter from URL
  useEffect(() => {
    if (!leafletLoaded || !mapInstanceRef.current || !focusParam || customers.length === 0) return

    const map = mapInstanceRef.current
    let targetLat: number | null = null
    let targetLng: number | null = null
    let targetLabel = ''

    if (focusParam.startsWith('farm_')) {
      const farmId = focusParam.replace('farm_', '')
      // Find farm in all customer farms
      let foundFarm: Farm | null = null
      let foundCustomer: Customer | null = null
      for (const cust of customers) {
        if (cust.farms) {
          const f = cust.farms.find(x => x.id === farmId)
          if (f) {
            foundFarm = f
            foundCustomer = cust
            break
          }
        }
      }
      if (foundFarm && foundFarm.gps_lat && foundFarm.gps_lng) {
        targetLat = foundFarm.gps_lat
        targetLng = foundFarm.gps_lng
        targetLabel = `${foundFarm.name} (${foundCustomer?.farm_name})`
      }
    } else {
      // It is a customer ID
      const cust = customers.find(c => c.id === focusParam)
      if (cust && cust.gps_lat && cust.gps_lng) {
        targetLat = cust.gps_lat
        targetLng = cust.gps_lng
        targetLabel = cust.farm_name
      }
    }

    if (targetLat && targetLng) {
      setCenterPoint({
        lat: targetLat,
        lng: targetLng,
        label: targetLabel,
        type: focusParam.startsWith('farm_') ? 'farm' : 'customer',
        id: focusParam
      })
      map.setView([targetLat, targetLng], 14)
    }
  }, [leafletLoaded, focusParam, customers])

  // 6. Draw Sales Route History (Polyline)
  useEffect(() => {
    if (!leafletLoaded || !mapInstanceRef.current || !routeMarkersGroupRef.current) return

    const map = mapInstanceRef.current
    const routeMarkersGroup = routeMarkersGroupRef.current

    // Clear previous route elements
    if (routingLineRef.current) {
      map.removeLayer(routingLineRef.current)
      routingLineRef.current = null
    }
    routeMarkersGroup.clearLayers()

    if (locationHistory.length === 0) return

    // Convert coordinates to L.LatLng array
    const coordinates = locationHistory.map(loc => [loc.gps_lat, loc.gps_lng])

    // Draw route path line
    routingLineRef.current = L.polyline(coordinates, {
      color: '#f97316', // orange color matching sales reps
      weight: 4,
      opacity: 0.8,
      dashArray: '5, 10' // dashed line
    }).addTo(map)

    // Render numbered markers showing the path sequence
    locationHistory.forEach((loc, idx) => {
      const timeStr = new Date(loc.recorded_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      const label = idx === 0 ? 'Bắt đầu' : idx === locationHistory.length - 1 ? 'Kết thúc' : `${idx + 1}`
      const bgColor = idx === 0 ? 'bg-emerald-500' : idx === locationHistory.length - 1 ? 'bg-rose-500' : 'bg-orange-500'

      const seqIcon = L.divIcon({
        html: `
          <div class="flex items-center justify-center w-5.5 h-5.5 rounded-full text-white font-bold text-[9px] shadow border border-white ${bgColor}">
            ${label}
          </div>
        `,
        className: 'custom-seq-icon',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      })

      L.marker([loc.gps_lat, loc.gps_lng], { icon: seqIcon })
        .addTo(routeMarkersGroup)
        .bindPopup(`
          <div class="font-sans text-[11px] p-1">
            <p class="font-bold text-gray-700">Điểm kiểm tra #${idx + 1}</p>
            <p class="text-gray-400 mt-0.5">Thời gian: ${timeStr}</p>
            <p class="text-gray-500">Tọa độ: ${loc.gps_lat.toFixed(6)}, ${loc.gps_lng.toFixed(6)}</p>
          </div>
        `)
    })

    // Fit map bounds to show entire route
    const bounds = L.latLngBounds(coordinates)
    map.fitBounds(bounds, { padding: [50, 50] })

  }, [leafletLoaded, locationHistory])

  // Fetch location history for selected representative & date
  const handleQueryRouteHistory = async () => {
    if (!selectedTrackingRepId) {
      alert('Vui lòng chọn nhân viên cần xem lộ trình!')
      return
    }

    setLoadingHistory(true)
    try {
      const startOfDay = `${trackingDate}T00:00:00.000Z`
      const endOfDay = `${trackingDate}T23:59:59.999Z`

      const { data, error } = await supabase
        .from('employee_locations')
        .select('gps_lat, gps_lng, recorded_at')
        .eq('employee_id', selectedTrackingRepId)
        .gte('recorded_at', startOfDay)
        .lte('recorded_at', endOfDay)
        .order('recorded_at', { ascending: true })

      if (error) throw error
      setLocationHistory(data || [])
      if (!data || data.length === 0) {
        alert('Không tìm thấy dữ liệu di chuyển nào của nhân viên trong ngày được chọn.')
      }
    } catch (err) {
      console.error('Error fetching route history:', err)
      alert('Đã xảy ra lỗi khi tải lộ trình di chuyển.')
    } finally {
      setLoadingHistory(false)
    }
  }

  // Clear tracking history from map
  const handleClearRouteTracking = () => {
    setLocationHistory([])
    setSelectedTrackingRepId('')
  }

  // Manual location reporting handler
  const handleManualReportLocation = async () => {
    if (!profile) return
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        try {
          const { error } = await supabase.from('employee_locations').insert({
            employee_id: profile.id,
            gps_lat: lat,
            gps_lng: lng
          })
          if (error) throw error

          // Center map to reported location
          if (mapInstanceRef.current) {
            mapInstanceRef.current.setView([lat, lng], 13)
          }
          setMyLocation([lat, lng])
          setCenterPoint({
            lat: lat,
            lng: lng,
            label: 'Vị trí của bạn (Vừa báo cáo)',
            type: 'mylocation'
          })

          // Update local state to show current marker immediately
          setEmployees(prev => prev.map(emp => {
            if (emp.id === profile.id) {
              return {
                ...emp,
                last_lat: lat,
                last_lng: lng,
                last_recorded_at: new Date().toISOString()
              }
            }
            return emp
          }))

          alert('✅ Báo cáo tọa độ GPS thành công!')
        } catch (err) {
          console.error('Manual report position failed:', err)
          alert('Không thể báo cáo vị trí của bạn lên hệ thống.')
        }
      }, () => {
        alert('Không thể truy cập tọa độ GPS. Hãy cấp quyền định vị cho trình duyệt.')
      })
    } else {
      alert('Trình duyệt không hỗ trợ định vị.')
    }
  }

  // Active Tab state in sidebar
  const [sidebarTab, setSidebarTab] = useState<'filter' | 'distance' | 'tracking'>('filter')

  return (
    <Layout activeMenu="Bản đồ KH">
      <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden relative">
        
        {/* Loading overlay */}
        {(loadingData || !leafletLoaded) && (
          <div className="absolute inset-0 bg-gray-700/40 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-white">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4"></div>
            <p className="font-semibold text-body-lg">Đang tải bản đồ &amp; dữ liệu định vị...</p>
          </div>
        )}

        {/* Error state */}
        {leafletError && (
          <div className="absolute inset-0 bg-gray-50 z-50 flex flex-col items-center justify-center text-gray-500 p-6 text-center">
            <Compass className="text-danger-500 mb-4" size={64} />
            <h2 className="text-h2 font-bold text-gray-800">Không thể tải bản đồ</h2>
            <p className="mt-2 text-body-md text-gray-400 max-w-sm">
              Không thể kết nối đến CDN để tải thư viện Leaflet. Vui lòng kiểm tra lại kết nối internet của bạn.
            </p>
          </div>
        )}

        {/* ── Left Side: Collapsible Sidebar ── */}
        <div className={`bg-gray-0 border-r border-gray-100 flex flex-col transition-all duration-300 z-30 shadow-lg ${
          sidebarOpen ? 'w-full md:w-[420px]' : 'w-0'
        } overflow-hidden`}>
          {sidebarOpen && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              
              {/* Sidebar Header Tabs */}
              <div className="flex border-b border-gray-100 bg-gray-25">
                <button
                  onClick={() => setSidebarTab('filter')}
                  className={`flex-1 py-3 text-tiny font-bold uppercase tracking-wider text-center border-b-2 ${
                    sidebarTab === 'filter' ? 'border-blue-500 text-blue-700 bg-gray-0' : 'border-transparent text-gray-400'
                  }`}
                >
                  Bộ lọc &amp; Trại nuôi
                </button>
                <button
                  id="tab-btn-distance"
                  onClick={() => setSidebarTab('distance')}
                  className={`flex-1 py-3 text-tiny font-bold uppercase tracking-wider text-center border-b-2 ${
                    sidebarTab === 'distance' ? 'border-blue-500 text-blue-700 bg-gray-0' : 'border-transparent text-gray-400'
                  }`}
                >
                  Công cụ Đo
                </button>
                <button
                  id="tab-btn-tracking"
                  onClick={() => setSidebarTab('tracking')}
                  className={`flex-1 py-3 text-tiny font-bold uppercase tracking-wider text-center border-b-2 ${
                    sidebarTab === 'tracking' ? 'border-blue-500 text-blue-700 bg-gray-0' : 'border-transparent text-gray-400'
                  }`}
                >
                  Đội ngũ Sale
                </button>
              </div>

              {/* Sidebar Content Canvas */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                
                {/* TAB 1: FILTERS */}
                {sidebarTab === 'filter' && (
                  <div className="space-y-6">
                    {/* Search block */}
                    <div className="space-y-1.5">
                      <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Tìm kiếm</label>
                      <div className="flex items-center bg-gray-25 border border-gray-100 rounded-lg px-3 h-10 w-full focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-50 transition-all">
                        <Search className="text-gray-400 mr-2 flex-shrink-0" size={16} />
                        <input
                          className="bg-transparent border-none focus:ring-0 text-body-md w-full placeholder-gray-450 p-0 focus:outline-none"
                          placeholder="Tên trại, mã, địa chỉ..."
                          type="text"
                          value={searchTerm}
                          onChange={e => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                          <button onClick={() => setSearchTerm('')} className="text-gray-400 hover:text-gray-600">
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Regional Dropdowns */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Tỉnh / Thành</label>
                        <select
                          className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-700 focus:outline-none"
                          value={selectedProvince}
                          onChange={e => {
                            setSelectedProvince(e.target.value)
                            setSelectedDistrict('all')
                          }}
                        >
                          <option value="all">Tất cả</option>
                          {provinces.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Quận / Huyện</label>
                        <select
                          className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-700 focus:outline-none disabled:opacity-50"
                          value={selectedDistrict}
                          onChange={e => setSelectedDistrict(e.target.value)}
                          disabled={selectedProvince === 'all'}
                        >
                          <option value="all">Tất cả</option>
                          {districts.map(d => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Customer Type Filter */}
                    <div className="space-y-1.5">
                      <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Phân loại đối tác</label>
                      <select
                        className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-700 focus:outline-none"
                        value={selectedType}
                        onChange={e => setSelectedType(e.target.value)}
                      >
                        <option value="all">Tất cả phân loại</option>
                        {Object.entries(CUSTOMER_TYPE_LABELS).map(([code, label]) => (
                          <option key={code} value={code}>{label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Sales Representative Filter */}
                    <div className="space-y-1.5">
                      <label className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Nhân viên phụ trách</label>
                      <select
                        className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-body-md text-gray-700 focus:outline-none"
                        value={selectedRep}
                        onChange={e => setSelectedRep(e.target.value)}
                      >
                        <option value="all">Tất cả nhân viên</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Statistics display */}
                    <div className="bg-blue-50/30 border border-blue-100 rounded-xl p-4 flex justify-between text-body-md">
                      <div>
                        <span className="text-gray-400 font-bold text-tiny uppercase block tracking-wider mb-0.5">Khách hàng</span>
                        <span className="text-h2 font-black text-blue-700">{filteredCustomers.length} <span className="text-body-md font-normal text-gray-400">hộ/trại</span></span>
                      </div>
                      <div className="border-l border-blue-100 pl-6">
                        <span className="text-gray-400 font-bold text-tiny uppercase block tracking-wider mb-0.5">Chuồng trại</span>
                        <span className="text-h2 font-black text-emerald-700">{filteredFarms.length} <span className="text-body-md font-normal text-gray-400">chuồng</span></span>
                      </div>
                    </div>

                    {/* Active Farm List inside Sidebar */}
                    <div className="space-y-3 pt-2">
                      <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Danh sách chuồng nuôi hiển thị ({filteredFarms.length})</span>
                      {filteredFarms.length === 0 ? (
                        <p className="text-body-md text-gray-400 italic py-4 text-center">Không có chuồng trại nào khớp bộ lọc.</p>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                          {filteredFarms.map(f => (
                            <div 
                              key={f.id} 
                              className="p-3 bg-gray-25/50 border border-gray-100 hover:border-blue-200 rounded-lg cursor-pointer transition-all flex justify-between items-center"
                              onClick={() => {
                                if (f.gps_lat && f.gps_lng && mapInstanceRef.current) {
                                  mapInstanceRef.current.setView([f.gps_lat, f.gps_lng], 13)
                                  setCenterPoint({
                                    lat: f.gps_lat,
                                    lng: f.gps_lng,
                                    label: `${f.name} (${f.customerName})`,
                                    type: 'farm',
                                    id: f.id
                                  })
                                } else {
                                  alert('Chuồng trại này chưa được thiết lập tọa độ GPS!')
                                }
                              }}
                            >
                              <div className="min-w-0 flex-1 pr-2">
                                <span className="font-bold text-body-md text-gray-700 block truncate">{f.name}</span>
                                <span className="text-tiny text-gray-400 block truncate">{f.customerName}</span>
                                <span className="text-[11px] text-gray-450 block truncate mt-0.5">{f.address || 'Chưa ghi địa chỉ'}</span>
                              </div>
                              <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 2: DISTANCE & RADIUS MEASURING */}
                {sidebarTab === 'distance' && (
                  <div className="space-y-6">
                    
                    {/* Selected Center point display */}
                    <div className="p-4 bg-gray-25 border border-gray-100 rounded-xl space-y-3">
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Điểm mốc (Tâm đo)</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Compass className="text-blue-500 shrink-0" size={16} />
                          <span className="font-bold text-body-md text-gray-700 truncate">
                            {centerPoint?.label || 'Chưa chọn'}
                          </span>
                        </div>
                        {centerPoint && (
                          <span className="text-tiny text-gray-400 block font-mono mt-0.5">
                            Tọa độ: {centerPoint.lat.toFixed(6)}, {centerPoint.lng.toFixed(6)}
                          </span>
                        )}
                      </div>
                      
                      {myLocation && (
                        <button
                          type="button"
                          onClick={() => {
                            setCenterPoint({
                              lat: myLocation[0],
                              lng: myLocation[1],
                              label: 'Vị trí của bạn',
                              type: 'mylocation'
                            })
                            if (mapInstanceRef.current) {
                              mapInstanceRef.current.setView(myLocation, 12)
                            }
                          }}
                          className="w-full py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-tiny font-bold transition-all flex items-center justify-center gap-1"
                        >
                          <Navigation size={12} />
                          Đặt mốc tại Vị trí của tôi
                        </button>
                      )}
                    </div>

                    {/* Radius Circle Filter Toggle */}
                    <div className="space-y-4 border-t border-gray-100 pt-4">
                      <div className="flex justify-between items-center">
                        <label className="text-body-md font-semibold text-gray-700 flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="w-4.5 h-4.5 text-blue-500 rounded border-gray-100 focus:ring-blue-500"
                            checked={enableRadiusFilter}
                            onChange={e => setEnableRadiusFilter(e.target.checked)}
                          />
                          Lọc theo Bán kính vùng phủ
                        </label>
                        <span className="text-tiny font-bold text-blue-650 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">
                          {radiusKm} km
                        </span>
                      </div>

                      {enableRadiusFilter && (
                        <div className="space-y-1">
                          <input
                            type="range"
                            min="2"
                            max="60"
                            step="1"
                            value={radiusKm}
                            onChange={e => setRadiusKm(Number(e.target.value))}
                            className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                          <div className="flex justify-between text-tiny text-gray-400">
                            <span>2 km</span>
                            <span>30 km</span>
                            <span>60 km</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* List sorted by distance */}
                    <div className="space-y-3 border-t border-gray-100 pt-4">
                      <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Danh mục chuồng trại theo khoảng cách</span>
                      
                      {!centerPoint ? (
                        <div className="p-6 border border-dashed border-gray-150 rounded-xl text-center text-gray-400 text-body-md">
                          Hãy chọn một địa điểm trên bản đồ hoặc bấm "Đặt mốc tại Vị trí của tôi" để đo khoảng cách.
                        </div>
                      ) : sortedDistanceItems.length === 0 ? (
                        <p className="text-body-md text-gray-400 italic text-center py-4">Không có khách/trại nào trong khu vực lọc.</p>
                      ) : (
                        <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                          {sortedDistanceItems.map(item => (
                            <div 
                              key={item.id} 
                              className="p-3 bg-gray-25/30 border border-gray-100 hover:border-blue-100 rounded-lg flex items-center justify-between"
                            >
                              <div className="min-w-0 flex-1 pr-3">
                                <span className="font-bold text-body-md text-gray-700 block truncate">{item.name}</span>
                                <span className="text-tiny text-gray-400 font-semibold block uppercase tracking-wider mt-0.5 text-[9px]">{item.typeLabel} • {item.code}</span>
                                <span className="text-[11px] text-gray-400 block truncate mt-0.5">{item.address || 'Chưa ghi địa chỉ'}</span>
                              </div>
                              
                              <div className="text-right flex-shrink-0">
                                <span className="font-black text-body-md text-blue-650 block tabular-nums">
                                  {item.distance < 1 ? `${Math.round(item.distance * 1000)} m` : `${item.distance.toFixed(1)} km`}
                                </span>
                                <button
                                  onClick={() => {
                                    if (mapInstanceRef.current) {
                                      mapInstanceRef.current.setView([item.lat, item.lng], 13)
                                    }
                                  }}
                                  className="text-tiny text-blue-500 hover:underline font-semibold mt-1"
                                >
                                  Định vị
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* TAB 3: SALES TEAM & GEOLOCATION SIMULATOR */}
                {sidebarTab === 'tracking' && (
                  <div className="space-y-6">
                    
                    {/* Active User Geolocation Simulator */}
                    <div className="p-5 bg-gradient-to-br from-orange-50/50 to-amber-50/20 border border-orange-100 rounded-xl space-y-4 shadow-inner">
                      <div>
                        <h4 className="font-bold text-body-md text-orange-950 flex items-center gap-1.5">
                          <Compass className="text-orange-500" size={18} />
                          Trình báo cáo vị trí của bạn
                        </h4>
                        <p className="text-tiny text-orange-850 mt-1 leading-relaxed">
                          Sử dụng định vị GPS thực tế của máy để cập nhật vị trí kinh doanh đi thị trường của bạn hoặc kích hoạt chế độ tự động gửi vị trí mỗi phút.
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleManualReportLocation}
                          className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-tiny font-bold shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1.5"
                        >
                          <Send size={12} />
                          Báo cáo vị trí hiện tại
                        </button>
                      </div>

                      <div className="flex justify-between items-center border-t border-orange-100/50 pt-3">
                        <span className="text-tiny font-bold text-orange-900 select-none">Tự động đồng bộ vị trí</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isAutoReporting}
                            onChange={(e) => setIsAutoReporting(e.target.checked)}
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
                        </label>
                      </div>
                    </div>

                    {/* Sales staff lists */}
                    <div className="space-y-3">
                      <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Trạng thái đội ngũ Sales ({employees.length})</span>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                        {employees.map(emp => {
                          const hasLoc = emp.last_lat && emp.last_lng
                          const dateStr = emp.last_recorded_at
                            ? new Date(emp.last_recorded_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                            : ''
                          return (
                            <div 
                              key={emp.id}
                              className={`p-3 bg-gray-25/50 border border-gray-100 rounded-lg flex items-center justify-between transition-all ${
                                selectedTrackingRepId === emp.id ? 'border-orange-200 bg-orange-25/10' : ''
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-tiny shrink-0">
                                  {emp.avatar_url ? (
                                    <img src={emp.avatar_url} class="w-full h-full rounded-full object-cover" />
                                  ) : emp.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <span className="font-bold text-body-md text-gray-700 block truncate">{emp.full_name}</span>
                                  <span className="text-tiny text-gray-400 block truncate">{emp.email}</span>
                                  <span className="text-[10px] block mt-0.5">
                                    {hasLoc ? (
                                      <span className="text-emerald-600 font-semibold flex items-center gap-0.5">
                                        <CheckCircle size={10} />
                                        Cập nhật: {dateStr}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400 italic">Chưa hoạt động</span>
                                    )}
                                  </span>
                                </div>
                              </div>

                              {hasLoc && (
                                <button
                                  onClick={() => {
                                    if (mapInstanceRef.current) {
                                      mapInstanceRef.current.setView([emp.last_lat!, emp.last_lng!], 13)
                                    }
                                    setSelectedTrackingRepId(emp.id)
                                  }}
                                  className="text-tiny font-bold text-orange-600 bg-orange-50 border border-orange-100 px-2.5 py-1 rounded-md hover:bg-orange-100 transition-colors"
                                >
                                  Định vị
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Route history query */}
                    <div className="space-y-4 border-t border-gray-100 pt-4">
                      <div>
                        <span className="text-tiny font-bold text-gray-400 uppercase tracking-wider block">Truy vết lộ trình di chuyển</span>
                        <p className="text-[10px] text-gray-400 mt-0.5">Vẽ đường đi trong ngày của nhân viên được chọn lên bản đồ.</p>
                      </div>

                      <div className="space-y-3 text-body-md">
                        <div className="space-y-1.5">
                          <label className="font-semibold text-gray-600 block">Chọn nhân viên</label>
                          <select
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-gray-700 focus:outline-none"
                            value={selectedTrackingRepId}
                            onChange={e => setSelectedTrackingRepId(e.target.value)}
                          >
                            <option value="">-- Chọn nhân viên --</option>
                            {employees.map(emp => (
                              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="font-semibold text-gray-600 block">Chọn ngày truy vết</label>
                          <input
                            type="date"
                            className="w-full h-10 px-3 bg-gray-25 border border-gray-150 rounded-lg text-gray-700 focus:outline-none"
                            value={trackingDate}
                            onChange={e => setTrackingDate(e.target.value)}
                          />
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleQueryRouteHistory}
                            disabled={loadingHistory || !selectedTrackingRepId}
                            className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-tiny font-bold shadow-sm transition-all flex items-center justify-center gap-1"
                          >
                            {loadingHistory ? (
                              <>
                                <RefreshCw size={12} className="animate-spin" />
                                Đang tải...
                              </>
                            ) : (
                              <>
                                <Eye size={13} />
                                Xem lộ trình
                              </>
                            )}
                          </button>
                          
                          {locationHistory.length > 0 && (
                            <button
                              type="button"
                              onClick={handleClearRouteTracking}
                              className="py-2 px-3 border border-gray-200 hover:bg-gray-50 text-gray-500 rounded-lg text-tiny font-bold transition-all"
                            >
                              Xóa vẽ
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                )}

              </div>

            </div>
          )}
        </div>

        {/* ── Toggle Sidebar Button ── */}
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          className="absolute left-[0] md:left-auto md:relative top-4 z-40 bg-gray-0 border border-gray-100 w-8 h-10 shadow-lg rounded-r-lg flex items-center justify-center text-gray-400 hover:text-gray-600"
          title={sidebarOpen ? 'Thu gọn bộ lọc' : 'Mở rộng bộ lọc'}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>

        {/* ── Right Side: Map Canvas ── */}
        <div className="flex-1 h-full relative">
          <div ref={mapContainerRef} className="w-full h-full z-10" />
          
          {/* Quick Stats Overlays */}
          <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 pointer-events-none md:flex-row">
            <div className="bg-gray-900/90 backdrop-blur text-white px-3 py-2 rounded-xl border border-gray-800 shadow-xl flex items-center gap-2 pointer-events-auto">
              <div className="w-3.5 h-3.5 rounded-full bg-blue-500"></div>
              <span className="text-tiny font-semibold text-gray-300">Khách hàng ({filteredCustomers.length})</span>
            </div>
            <div className="bg-gray-900/90 backdrop-blur text-white px-3 py-2 rounded-xl border border-gray-800 shadow-xl flex items-center gap-2 pointer-events-auto">
              <div className="w-3.5 h-3.5 rounded-full bg-emerald-600"></div>
              <span className="text-tiny font-semibold text-gray-300">Chuồng nuôi ({filteredFarms.length})</span>
            </div>
            <div className="bg-gray-900/90 backdrop-blur text-white px-3 py-2 rounded-xl border border-gray-800 shadow-xl flex items-center gap-2 pointer-events-auto">
              <div className="w-3.5 h-3.5 rounded-full bg-orange-500"></div>
              <span className="text-tiny font-semibold text-gray-300">Đội ngũ Sales ({employees.filter(e => e.last_lat).length})</span>
            </div>
          </div>
        </div>

      </div>
    </Layout>
  )
}
