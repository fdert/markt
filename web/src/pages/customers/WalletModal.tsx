// محفظة العميل: الرصيد والشحن والحركات
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { money, dateTime, PAYMENT_LABELS } from '../../lib/format';
import { Button, Empty, Modal, NumberInput, Select, Spinner, clsx, useToast } from '../../components/ui';

const TYPES: Record<string, string> = { TOPUP: 'شحن', PAYMENT: 'دفع فاتورة', REFUND: 'استرداد', ADJUST: 'تعديل' };

export function WalletModal({ customer, onClose }: { customer: { id: number; name: string } | null; onClose: () => void }) {
  const { branchId } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [amount, setAmount] = useState<number | null>(null); const [method, setMethod] = useState('CASH');
  const { data } = useQuery({ queryKey: ['wallet', customer?.id], queryFn: () => api<{ walletBalance: number; transactions: Array<{ id: number; amount: number; balanceAfter: number; type: string; method: string | null; note: string | null; createdAt: string }> }>(`/customers/${customer!.id}/wallet`), enabled: !!customer });
  const topup = useMutation({ mutationFn: () => api('/customers/' + customer!.id + '/wallet/topup', { body: { amount, method, branchId } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['wallet'] }); qc.invalidateQueries({ queryKey: ['customer'] }); setAmount(null); toast.success('تم شحن المحفظة.'); }, onError: toast.error });
  return (
    <Modal open={!!customer} onClose={onClose} title={`محفظة ${customer?.name ?? ''}`} size="md">
      {!data ? <Spinner /> : <div className="space-y-4">
        <div className="rounded-xl bg-brand-50 p-4 flex justify-between items-center"><span className="text-brand-800">الرصيد الحالي</span><span className="text-3xl font-extrabold num">{money(data.walletBalance)}</span></div>
        <div className="flex gap-2 items-end">
          <NumberInput label="مبلغ الشحن" value={amount} onChange={setAmount} suffix="ر.س" />
          <Select label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">نقدي</option><option value="CARD">شبكة</option><option value="BANK_TRANSFER">تحويل</option></Select>
          <Button loading={topup.isPending} disabled={!amount} onClick={() => topup.mutate()}>شحن</Button>
        </div>
        <section><h3 className="font-bold mb-2">الحركات</h3>
          {!data.transactions.length ? <Empty title="لا حركات" /> : <ul className="divide-y divide-ink-100 text-[14px]">{data.transactions.map((t) => (
            <li key={t.id} className="flex justify-between py-2"><span>{TYPES[t.type] ?? t.type}{t.method && t.type === 'TOPUP' && <span className="text-ink-500"> · {PAYMENT_LABELS[t.method] ?? t.method}</span>}<span className="block text-xs text-ink-500">{t.note} · {dateTime(t.createdAt)}</span></span>
              <span className="text-end"><span className={clsx('num font-bold', t.amount < 0 ? 'text-red-600' : 'text-emerald-700')}>{t.amount > 0 ? '+' : ''}{money(t.amount)}</span><span className="block text-xs text-ink-500 num">{money(t.balanceAfter)}</span></span></li>
          ))}</ul>}
        </section>
      </div>}
    </Modal>
  );
}
