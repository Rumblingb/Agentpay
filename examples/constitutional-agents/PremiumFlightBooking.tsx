/**
 * PREMIUM FLIGHT BOOKING INTERFACE
 * 
 * Showcases the two-agent workflow:
 * 1. FlightDiscoveryAgent → Search and recommend
 * 2. TravelExecutionAgent → Book and confirm
 * 
 * This is the UI that demonstrates your vision.
 */

import React, { useState } from 'react';
import { 
  Plane, 
  Search, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  Users, 
  Calendar,
  TrendingDown,
  Zap,
  Shield,
  ArrowRight
} from 'lucide-react';

interface BookingStep {
  id: number;
  name: string;
  agent: 'discovery' | 'execution';
  status: 'pending' | 'active' | 'completed';
}

export function PremiumFlightBooking() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [searchData, setSearchData] = useState<any>(null);
  const [selectedOffer, setSelectedOffer] = useState<any>(null);
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const steps: BookingStep[] = [
    { id: 1, name: 'Search Flights', agent: 'discovery', status: currentStep === 1 ? 'active' : (currentStep > 1 ? 'completed' : 'pending') },
    { id: 2, name: 'Select & Review', agent: 'discovery', status: currentStep === 2 ? 'active' : (currentStep > 2 ? 'completed' : 'pending') },
    { id: 3, name: 'Passenger Details', agent: 'execution', status: currentStep === 3 ? 'active' : (currentStep > 3 ? 'completed' : 'pending') },
    { id: 4, name: 'Payment & Confirm', agent: 'execution', status: currentStep === 4 ? 'active' : (currentStep > 4 ? 'completed' : 'pending') },
  ];

  // Step 1: Search Form
  const SearchForm = () => (
    <div className="max-w-4xl mx-auto">
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center">
            <Plane className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Find Your Flight</h2>
            <p className="text-blue-100 text-sm">Powered by FlightDiscoveryAgent</p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="From (e.g., LAX)"
              className="px-4 py-3 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-white placeholder-white/60 focus:ring-2 focus:ring-white/50"
            />
            <input
              type="text"
              placeholder="To (e.g., JFK)"
              className="px-4 py-3 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-white placeholder-white/60 focus:ring-2 focus:ring-white/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <input
              type="date"
              className="px-4 py-3 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-white focus:ring-2 focus:ring-white/50"
            />
            <input
              type="date"
              placeholder="Return (optional)"
              className="px-4 py-3 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-white focus:ring-2 focus:ring-white/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <select className="px-4 py-3 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-white focus:ring-2 focus:ring-white/50">
              <option value="1">1 Passenger</option>
              <option value="2">2 Passengers</option>
              <option value="3">3 Passengers</option>
              <option value="4">4+ Passengers</option>
            </select>
            <select className="px-4 py-3 rounded-lg bg-white/10 backdrop-blur border border-white/20 text-white focus:ring-2 focus:ring-white/50">
              <option value="economy">Economy</option>
              <option value="premium_economy">Premium Economy</option>
              <option value="business">Business</option>
              <option value="first">First Class</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full bg-white text-blue-600 py-4 rounded-lg font-semibold hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
            disabled={loading}
          >
            {loading ? (
              <>Searching 10+ Airlines...</>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Search Flights ($15)
              </>
            )}
          </button>
        </form>

        {/* Agent Trust Badge */}
        <div className="mt-6 flex items-center justify-between text-white/80 text-sm">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span>Verified Agent • Trust Score: 92/100</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span>Avg. Savings: $183</span>
          </div>
        </div>
      </div>
    </div>
  );

  // Step 2: Flight Results
  const FlightResults = () => (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* AI Recommendation Banner */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-6 text-white">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <TrendingDown className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg mb-1">AI Recommendation</h3>
            <p className="text-sm text-green-50 mb-3">
              Best value: United 1247 → Save $215 vs average price. Direct flight, optimal departure time.
            </p>
            <button className="bg-white text-green-600 px-6 py-2 rounded-lg font-semibold hover:bg-green-50 transition-all">
              Book This Flight →
            </button>
          </div>
        </div>
      </div>

      {/* Flight Options */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-all">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-4 mb-4">
                  <img 
                    src="/airline-logo.png" 
                    alt="United" 
                    className="w-12 h-12 rounded"
                  />
                  <div>
                    <p className="font-bold text-lg">United Airlines</p>
                    <p className="text-sm text-gray-500">UA 1247 • Direct Flight</p>
                  </div>
                </div>

                <div className="flex items-center gap-8">
                  <div>
                    <p className="text-2xl font-bold">8:00 AM</p>
                    <p className="text-sm text-gray-500">LAX</p>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 border-t-2 border-gray-300 border-dashed"></div>
                    <Plane className="w-5 h-5 text-gray-400" />
                    <div className="flex-1 border-t-2 border-gray-300 border-dashed"></div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-500">5h 30m</p>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 border-t-2 border-gray-300 border-dashed"></div>
                    <div className="flex-1 border-t-2 border-gray-300 border-dashed"></div>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">4:30 PM</p>
                    <p className="text-sm text-gray-500">JFK</p>
                  </div>
                </div>
              </div>

              <div className="text-right ml-8">
                <p className="text-3xl font-bold text-blue-600 mb-1">$387</p>
                <p className="text-sm text-green-600 font-medium mb-3">Save $215</p>
                <button
                  onClick={() => handleSelectFlight(i)}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-all"
                >
                  Select →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Agent Performance */}
      <div className="bg-gray-50 rounded-xl p-6">
        <h3 className="font-semibold mb-4">FlightDiscoveryAgent Performance</h3>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Searches</p>
            <p className="text-2xl font-bold">1,247</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Success Rate</p>
            <p className="text-2xl font-bold">99.2%</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Avg. Savings</p>
            <p className="text-2xl font-bold">$183</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Trust Score</p>
            <p className="text-2xl font-bold">92/100</p>
          </div>
        </div>
      </div>
    </div>
  );

  // Step 3: Passenger Details
  const PassengerForm = () => (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Passenger Information</h2>
            <p className="text-gray-500 text-sm">Powered by TravelExecutionAgent</p>
          </div>
        </div>

        <form onSubmit={handleBooking} className="space-y-6">
          <div className="space-y-4">
            <h3 className="font-semibold">Passenger 1</h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="First Name"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Last Name"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                placeholder="Date of Birth"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <select className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold">Contact Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="email"
                placeholder="Email"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="tel"
                placeholder="Phone"
                className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
          >
            Continue to Payment
            <ArrowRight className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );

  // Step 4: Payment & Confirmation
  const PaymentStep = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Price Summary */}
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
        <h3 className="font-bold text-xl mb-6">Price Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">Base Fare (1 passenger)</span>
            <span className="font-semibold">$387.00</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Taxes & Fees</span>
            <span className="font-semibold">$78.20</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>FlightDiscoveryAgent Fee</span>
            <span>$15.00</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>TravelExecutionAgent Fee (3%)</span>
            <span>$11.61</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Ticket Issuance Fee</span>
            <span>$15.00</span>
          </div>
          <div className="border-t-2 pt-3 flex justify-between text-xl font-bold">
            <span>Total</span>
            <span className="text-blue-600">$506.81</span>
          </div>
        </div>
      </div>

      {/* Payment Method */}
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
        <h3 className="font-bold text-xl mb-6">Payment Method</h3>
        
        <div className="space-y-4 mb-6">
          <button className="w-full border-2 border-blue-600 bg-blue-50 rounded-xl p-4 flex items-center justify-between hover:bg-blue-100 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <p className="font-semibold">Pay with USDC (x402)</p>
                <p className="text-sm text-gray-600">Instant settlement, no chargebacks</p>
              </div>
            </div>
            <CheckCircle2 className="w-6 h-6 text-blue-600" />
          </button>

          <button className="w-full border-2 border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-gray-300 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-gray-600" />
              </div>
              <div className="text-left">
                <p className="font-semibold">Pay with Credit Card</p>
                <p className="text-sm text-gray-600">Visa, Mastercard, Amex</p>
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={handleConfirmBooking}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-lg font-bold hover:from-blue-700 hover:to-blue-800 transition-all flex items-center justify-center gap-2"
          disabled={loading}
        >
          {loading ? (
            <>Processing Booking...</>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5" />
              Confirm & Pay $506.81
            </>
          )}
        </button>

        {/* Agent Trust Badge */}
        <div className="mt-6 pt-6 border-t flex items-center justify-center gap-2 text-sm text-gray-600">
          <Shield className="w-4 h-4" />
          <span>Secured by TravelExecutionAgent • Trust Score: 94/100</span>
        </div>
      </div>
    </div>
  );

  // Success State
  const BookingSuccess = () => (
    <div className="max-w-2xl mx-auto text-center">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-12">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-600" />
        </div>
        
        <h2 className="text-3xl font-bold mb-2">Booking Confirmed!</h2>
        <p className="text-gray-600 mb-8">Your flight has been successfully booked</p>

        <div className="bg-gray-50 rounded-xl p-6 mb-8">
          <div className="grid grid-cols-2 gap-4 text-left">
            <div>
              <p className="text-sm text-gray-600 mb-1">Booking Reference</p>
              <p className="font-bold text-lg">ABC123</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Ticket Number</p>
              <p className="font-bold text-lg">125987654321</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Flight</p>
              <p className="font-bold">UA 1247</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Departure</p>
              <p className="font-bold">LAX 8:00 AM</p>
            </div>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          Confirmation email sent to your inbox. E-ticket attached.
        </p>

        <button className="bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700">
          View Booking Details
        </button>
      </div>
    </div>
  );

  // Event handlers
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Call FlightDiscoveryAgent API
    // const result = await fetch('/api/agents/flight-discovery', { ... });
    
    setTimeout(() => {
      setLoading(false);
      setCurrentStep(2);
    }, 2000);
  };

  const handleSelectFlight = (flightId: number) => {
    setSelectedOffer(flightId);
    setCurrentStep(3);
  };

  const handleBooking = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentStep(4);
  };

  const handleConfirmBooking = async () => {
    setLoading(true);
    
    // Call TravelExecutionAgent API
    // const result = await fetch('/api/agents/travel-execution', { ... });
    
    setTimeout(() => {
      setLoading(false);
      setCurrentStep(5);
    }, 3000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-12 px-4">
      {/* Progress Steps */}
      <div className="max-w-4xl mx-auto mb-12">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold mb-2 transition-all ${
                  step.status === 'completed' 
                    ? 'bg-green-500 text-white' 
                    : step.status === 'active'
                    ? 'bg-blue-600 text-white ring-4 ring-blue-200'
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {step.status === 'completed' ? <CheckCircle2 className="w-6 h-6" /> : step.id}
                </div>
                <p className={`text-sm font-medium text-center ${
                  step.status === 'active' ? 'text-blue-600' : 'text-gray-600'
                }`}>
                  {step.name}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {step.agent === 'discovery' ? 'Discovery Agent' : 'Execution Agent'}
                </p>
              </div>
              {index < steps.length - 1 && (
                <div className={`h-1 flex-1 mx-2 ${
                  step.status === 'completed' ? 'bg-green-500' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      {currentStep === 1 && <SearchForm />}
      {currentStep === 2 && <FlightResults />}
      {currentStep === 3 && <PassengerForm />}
      {currentStep === 4 && <PaymentStep />}
      {currentStep === 5 && <BookingSuccess />}
    </div>
  );
}
