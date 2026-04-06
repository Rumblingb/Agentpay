export type Principal = {
  id: string // usr_xxx
  name: string
  profileId: string
  defaultPaymentMethodId?: string
  policySetId: string
  trustedOperatorIds: string[]
  createdAt: string
  updatedAt: string
}
