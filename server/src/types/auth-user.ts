export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  isGuest: boolean;
}
