import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';

export interface Me {
  user: { id: number; name: string; email: string; role: string; branchId: number | null; permissions: string[]; maxDiscount: number | null };
  store: { name: string; logo: string; currencySymbol: string };
  branches: Array<{ id: number; name: string; type: string; isDefault: boolean }>;
}

interface AuthCtx { me: Me | undefined; loading: boolean; branchId: number; setBranchId: (id: number) => void; can: (...p: string[]) => boolean; login: (t: string) => void; logout: () => void }
const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState(tokenStore.get());
  const { data: me, isLoading } = useQuery({ queryKey: ['me', token], queryFn: () => api<Me>('/auth/me'), enabled: !!token, staleTime: 60_000 });
  const [branchId, setBranch] = useState<number>(() => { try { return Number(localStorage.getItem('raseed.branch')) || 0; } catch { return 0; } });
  useEffect(() => {
    if (!me) return;
    const sellable = me.branches.filter((b) => b.type === 'BRANCH');
    if (!me.branches.some((b) => b.id === branchId)) setBranch(me.user.branchId ?? sellable.find((b) => b.isDefault)?.id ?? sellable[0]?.id ?? 0);
  }, [me, branchId]);
  const value = useMemo<AuthCtx>(() => ({
    me, loading: !!token && isLoading, branchId,
    setBranchId: (id) => { setBranch(id); try { localStorage.setItem('raseed.branch', String(id)); } catch { /* تجاهل */ } },
    can: (...p) => !!me && p.some((x) => me.user.permissions.includes(x)),
    login: (t) => { tokenStore.set(t); setToken(t); },
    logout: () => { tokenStore.set(null); setToken(null); qc.clear(); },
  }), [me, token, isLoading, branchId, qc]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
