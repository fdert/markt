import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge, Button, Card, Confirm, Empty, Input, Modal, PageHeader, Select, Spinner, Stat, Textarea, Toggle, useToast } from '../../components/ui';

interface Cat { id: number; name: string; nameEn: string | null; description: string | null; parentId: number | null; active: boolean; productsCount: number; image: string | null }

export default function CategoriesPage() {
  const qc = useQueryClient(); const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: () => api<Cat[]>('/categories') });
  const [edit, setEdit] = useState<Partial<Cat> | null>(null); const [del, setDel] = useState<Cat | null>(null);
  const save = useMutation({ mutationFn: () => api(edit!.id ? `/categories/${edit!.id}` : '/categories', { method: edit!.id ? 'PUT' : 'POST', body: { name: edit!.name, nameEn: edit!.nameEn || null, description: edit!.description || null, parentId: edit!.parentId || null, active: edit!.active ?? true } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setEdit(null); toast.success('تم الحفظ.'); }, onError: toast.error });
  const remove = useMutation({ mutationFn: () => api(`/categories/${del!.id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setDel(null); toast.success('تم الحذف.'); }, onError: toast.error });
  const roots = data?.filter((c) => !c.parentId) ?? [];
  const row = (c: Cat, child = false) => (
    <tr key={c.id}><td className={child ? 'ps-10' : ''}>{child && '↳ '}<span className="font-medium">{c.name}</span>{c.nameEn && <span className="text-ink-500 text-sm" dir="ltr"> · {c.nameEn}</span>}</td>
      <td className="num">{c.productsCount}</td><td>{c.active ? <Badge tone="green">مفعّل</Badge> : <Badge>معطّل</Badge>}</td>
      <td className="text-end"><Button size="sm" variant="ghost" aria-label={`تعديل ${c.name}`} onClick={() => setEdit(c)}><Pencil className="size-4" /></Button><Button size="sm" variant="ghost" aria-label={`حذف ${c.name}`} onClick={() => setDel(c)}><Trash2 className="size-4" /></Button></td></tr>
  );
  return (
    <>
      <PageHeader title="التصنيفات" actions={<Button onClick={() => setEdit({ active: true })}><Plus className="size-4" />تصنيف جديد</Button>} />
      <div className="grid grid-cols-3 gap-3 mb-5"><Stat label="إجمالي التصنيفات" value={data?.length ?? 0} /><Stat label="تصنيفات رئيسية" value={roots.length} /><Stat label="تصنيفات فرعية" value={(data?.length ?? 0) - roots.length} /></div>
      <Card bodyClass="!p-0">{isLoading ? <Spinner /> : !data?.length ? <Empty title="لا تصنيفات بعد" /> : (
        <table className="table w-full"><thead><tr><th>التصنيف</th><th>المنتجات</th><th>الحالة</th><th /></tr></thead>
          <tbody>{roots.map((r) => [row(r), ...data.filter((c) => c.parentId === r.id).map((c) => row(c, true))])}</tbody></table>
      )}</Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل التصنيف' : 'تصنيف جديد'} size="sm" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button><Button loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button></>}>
        {edit && <div className="space-y-3">
          <Input label="اسم التصنيف" required value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Input label="الاسم بالإنجليزية (اختياري)" dir="ltr" value={edit.nameEn ?? ''} onChange={(e) => setEdit({ ...edit, nameEn: e.target.value })} />
          <Select label="التصنيف الأب" value={edit.parentId ?? ''} onChange={(e) => setEdit({ ...edit, parentId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">بلا (تصنيف رئيسي)</option>{roots.filter((r) => r.id !== edit.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Textarea label="وصف التصنيف (اختياري)" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <Toggle checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="مفعّل" />
        </div>}
      </Modal>
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger title="حذف التصنيف" message={`هل تريد حذف «${del?.name}»؟ لا يمكن التراجع عن الحذف.`} confirmText="حذف" />
    </>
  );
}
