export interface AuthUser {
  id: string
  email: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface SignupCredentials {
  email: string
  password: string
  confirmPassword: string
}
