import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, whoami, Oops } from '@/lib/admin';
import { DEFAULT_MAX_MEMBERS, DEFAULT_MAX_HOMES, newCode } from '@/lib/home';
import type { PetData } from '@/types/pet';

// Panel de administración (/admin). Cada llamada comprueba aquí que el token es de un correo de ADMIN_EMAILS:
// ocultar la página en el cliente no protege nada.
const limit = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Oops('El límite debe ser un número entre 1 y 50.');
  return n;
};

export async function POST(req: Request) {
  const me = await whoami(req);
  if (!me) return NextResponse.json({ error: 'Inicia sesión con Google.' }, { status: 401 });
  if (!me.admin) return NextResponse.json({ error: 'Esta cuenta no es administradora.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = adminDb(), config = db.doc('config/app');

  try {
    switch (body.op) {
      case 'list': {
        // ponytail: lee todos los hogares de una vez; paginar cuando sean cientos.
        const [cfg, pets] = await Promise.all([config.get(), db.collection('pets').get()]);
        return NextResponse.json({
          maxMembers: cfg.data()?.maxMembers ?? DEFAULT_MAX_MEMBERS,
          maxHomes: cfg.data()?.maxHomes ?? DEFAULT_MAX_HOMES,
          pets: pets.docs.map(d => {
            const p = d.data() as PetData;
            return {
              id: d.id, name: p.name, inviteCode: p.inviteCode ?? null, maxMembers: p.maxMembers ?? null, lastUpdated: p.lastUpdated,
              members: Object.entries(p.members ?? {}).map(([uid, m]) => ({ name: m.name, owner: uid === p.owner })),
            };
          }).sort((a, b) => b.lastUpdated - a.lastUpdated),
        });
      }
      // Límite global, o el propio de un hogar (`petId`; vacío = vuelve al global). No expulsa a quien ya está dentro.
      case 'limit': {
        // `maxHomes`: hogares por persona (solo global).
        if (body.maxHomes !== undefined) await config.set({ maxHomes: limit(body.maxHomes) }, { merge: true });
        else if (!body.petId) await config.set({ maxMembers: limit(body.maxMembers) }, { merge: true });
        else await db.doc(`pets/${body.petId}`).update({ maxMembers: body.maxMembers === null || body.maxMembers === '' ? FieldValue.delete() : limit(body.maxMembers) });
        return NextResponse.json({ ok: true });
      }
      // Código nuevo para cualquier hogar (p. ej. el Pocky original, que nació sin código ni miembros).
      case 'code': {
        const inviteCode = newCode(randomInt);
        await db.doc(`pets/${body.petId}`).update({ inviteCode });
        return NextResponse.json({ inviteCode });
      }
    }
    return NextResponse.json({ error: 'Operación desconocida.' }, { status: 400 });
  } catch (e) {
    if (e instanceof Oops) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[admin]', e);
    return NextResponse.json({ error: 'Error del servidor.' }, { status: 500 });
  }
}
