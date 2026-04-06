import type { TripIntent, JourneySession, BookingState } from '../ace-core/src/index'

// ── Booking adapter ───────────────────────────────────────────────────────────

export type BookingRequest = {
  intent: TripIntent
  passengerDetails?: {
    name: string
    email: string
    railcardType?: string
    documentRef?: string
  }
}

export type BookingLeg = {
  mode: 'rail' | 'flight' | 'cab' | 'bus' | 'hotel' | 'ferry'
  from: string
  to: string
  departs: string // ISO 8601
  arrives: string // ISO 8601
  ref: string // supplier booking reference
  ticketUrl?: string
  platformOrGate?: string
}

export type BookingResult = {
  success: boolean
  legs: BookingLeg[]
  totalAmountGbp: number
  currency: string
  receiptRef: string
  error?: string
}

/**
 * BookingAdapter — interface for transport-specific booking implementations.
 * Rail, flight, hotel, cab adapters each implement this interface.
 */
export interface BookingAdapter {
  readonly mode: BookingLeg['mode']
  book(request: BookingRequest): Promise<BookingResult>
  cancel(bookingRef: string): Promise<{ success: boolean; error?: string }>
  getStatus(bookingRef: string): Promise<{ state: BookingState; detail?: string }>
}

// ── Payment adapter ───────────────────────────────────────────────────────────

export type PaymentRequest = {
  principalId: string
  amountGbp: number
  currency: string
  description: string
  metadata?: Record<string, string>
}

export type PaymentResult = {
  success: boolean
  paymentIntentId: string
  status: 'pending' | 'confirmed' | 'failed'
  error?: string
}

/**
 * PaymentAdapter — interface for payment provider implementations.
 * Stripe, Razorpay, and Airwallex adapters each implement this interface.
 */
export interface PaymentAdapter {
  readonly provider: string
  charge(request: PaymentRequest): Promise<PaymentResult>
  refund(paymentIntentId: string, amountGbp?: number): Promise<PaymentResult>
}
