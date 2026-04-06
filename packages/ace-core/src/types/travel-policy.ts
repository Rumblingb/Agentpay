export type OperatorPermission = {
  operatorId: string
  allowedActions: string[] // 'plan' | 'book_rail' | 'book_flight' | 'book_hotel' | 'cancel'
  spendLimitGbp?: number
  requiresHumanConfirmAboveGbp?: number
}

export type TravelPolicy = {
  id: string // pol_xxx
  principalId: string
  autoBookRailUnderGbp?: number
  autoBookHotelUnderGbp?: number
  requireHumanApprovalForFlights: boolean
  maxArrivalHour?: number // 0-23
  avoidArrivalAfterHour?: number
  preferDirect: boolean
  preferredSeat?: 'window' | 'aisle' | 'any'
  preferredClass?: 'standard' | 'first'
  businessClassFlightsOverHours?: number
  operatorPermissions: OperatorPermission[]
  updatedAt: string
}
