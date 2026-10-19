import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isConfigured = Boolean(url && key && !url.includes('TU-PROYECTO'));
export const supabase = isConfigured ? createClient(url!, key!) : null;
export type Slot = { id: string; starts_at: string };
export type Booking = { id: string; slot_id: string; customer_name: string; phone: string; email?: string; starts_at?: string; slot?: Slot };
export const formatDate = (value: string) => new Intl.DateTimeFormat('es-ES', { weekday:'long', day:'numeric', month:'long' }).format(new Date(value));
export const formatTime = (value: string) => new Intl.DateTimeFormat('es-ES', { hour:'2-digit', minute:'2-digit' }).format(new Date(value));
