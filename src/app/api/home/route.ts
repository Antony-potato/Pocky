import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, whoami, widgetKey, Oops } from '@/lib/admin';
import { DEFAULT_MAX_MEMBERS, DEFAULT_MAX_HOMES, CODE_LENGTH, joinError, homesError, newCode, normalizeCode } from '@/lib/home';
import { DEFAULT_PET } from '@/lib/petLogic';
import type { PetData } from '@/types/pet';

/**
 * Hogares: crear mascota, unirse con código, salir, renovar el código. Todo aquí (Admin SDK) y no en el cliente:
 * los límites (personas por hogar, hogares por persona) y quién es miembro no se pueden dejar en manos del móvil.
 * Las reglas de Firestore impiden que un cliente toque `members`, `owner` o `inviteCode`.
 * Cada persona: users/{uid}.petIds (sus hogares). En cuál está jugando lo decide cada móvil (localStorage).
 * ponytail: sin límite de intentos de código (hace falta sesión de Google y hay 887 M de códigos); si alguien lo
 * fuerza, contar fallos en users/{uid}.
 */
export async function POST(req: Request) {
  const me = await whoami(req);
  if (!me) return NextResponse.json({ error: 'Inicia sesión con Google.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = adminDb(), userRef = db.doc(`users/${me.uid}`), config = db.doc('config/app');
  const member = { name: me.name, joinedAt: Date.now() };
  const profile = { name: me.name, email: me.email };
  const petRef = (id: unknown) => {
    if (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id)) throw new Oops('Hogar desconocido.');
    return db.doc(`pets/${id}`);
  };

  try {
    switch (body.op) {
      // Los hogares de esta sesión (y la hora del servidor, para igualar relojes).
      case 'me': {
        // Hogares reservados a este correo (claims/{correo}.petIds; los pone el admin a mano, p. ej. el Pocky original
        // para su dueño): se le dan al entrar, sin código y sin contar para los límites. Solo con correo verificado.
        const claimRef = db.doc(`claims/${me.email}`);
        if (me.verified) await db.runTransaction(async tx => {
          const ids: string[] = (await tx.get(claimRef)).data()?.petIds ?? [];
          if (!ids.length) return;
          const pets = await tx.getAll(...ids.map(petRef));
          for (const p of pets) if (p.exists) tx.update(p.ref, {
            [`members.${me.uid}`]: member, ...(p.data()!.owner ? {} : { owner: me.uid }), ...(p.data()!.inviteCode ? {} : { inviteCode: newCode(randomInt) }),
          });
          tx.set(userRef, { ...profile, petIds: FieldValue.arrayUnion(...ids) }, { merge: true });
          tx.delete(claimRef);
        });
        const ids: string[] = (await userRef.get()).data()?.petIds ?? [];
        const pets = ids.length ? await db.getAll(...ids.map(petRef)) : [];
        const homes = pets.filter(p => p.exists && me.uid in (p.data()!.members ?? {})).map(p => ({ id: p.id, name: p.data()!.name as string }));
        return NextResponse.json({ now: Date.now(), admin: me.admin, homes });
      }

      case 'create': {
        const name = String(body.name ?? '').trim().slice(0, 20);
        if (!name) throw new Oops('Ponle un nombre a tu mascota.');
        const ref = db.collection('pets').doc();
        await db.runTransaction(async tx => {
          const [user, cfg] = await tx.getAll(userRef, config);
          const full = homesError((user.data()?.petIds ?? []).length, cfg.data()?.maxHomes ?? DEFAULT_MAX_HOMES);
          if (full) throw new Oops(full);
          const now = Date.now();
          tx.set(ref, { ...DEFAULT_PET, name, createdAt: now, lastUpdated: now, owner: me.uid, members: { [me.uid]: member }, inviteCode: newCode(randomInt) });
          tx.set(userRef, { ...profile, petIds: FieldValue.arrayUnion(ref.id) }, { merge: true });
        });
        return NextResponse.json({ petId: ref.id });
      }

      case 'join': {
        const code = normalizeCode(String(body.code ?? ''));
        if (code.length !== CODE_LENGTH) throw new Oops(`El código tiene ${CODE_LENGTH} letras y números.`);
        const petId = await db.runTransaction(async tx => {
          const [user, cfg] = await tx.getAll(userRef, config);
          const found = await tx.get(db.collection('pets').where('inviteCode', '==', code).limit(1));
          if (found.empty) throw new Oops('Ese código no existe. Pide uno nuevo a quien te invitó.');
          const pet = found.docs[0], data = pet.data() as PetData, mine: string[] = user.data()?.petIds ?? [];
          if (me.uid in (data.members ?? {}) && mine.includes(pet.id)) return pet.id; // ya estaba: solo entra
          const full = homesError(mine.length, cfg.data()?.maxHomes ?? DEFAULT_MAX_HOMES) ?? joinError(data, me.uid, cfg.data()?.maxMembers ?? DEFAULT_MAX_MEMBERS);
          if (full) throw new Oops(full);
          // Un hogar sin dueño: el primero que entra se lo queda.
          tx.update(pet.ref, { [`members.${me.uid}`]: member, ...(data.owner ? {} : { owner: me.uid }) });
          tx.set(userRef, { ...profile, petIds: FieldValue.arrayUnion(pet.id) }, { merge: true });
          return pet.id;
        });
        return NextResponse.json({ petId });
      }

      case 'leave': {
        const ref = petRef(body.petId);
        await db.runTransaction(async tx => {
          const pet = (await tx.get(ref)).data() as PetData | undefined;
          if (pet && me.uid in (pet.members ?? {})) {
            const others = Object.keys(pet.members ?? {}).filter(u => u !== me.uid);
            // ponytail: si se va el último, la mascota se queda sin nadie (no se borra); el admin la ve en el panel.
            tx.update(ref, { [`members.${me.uid}`]: FieldValue.delete(), ...(pet.owner === me.uid && { owner: others[0] ?? '' }) });
          }
          tx.set(userRef, { petIds: FieldValue.arrayRemove(ref.id) }, { merge: true });
        });
        return NextResponse.json({ ok: true });
      }

      // Código nuevo (el viejo deja de servir; los que ya están dentro siguen). Solo quien creó el hogar.
      case 'code': {
        const ref = petRef(body.petId);
        const inviteCode = await db.runTransaction(async tx => {
          const pet = (await tx.get(ref)).data() as PetData | undefined;
          if (!pet || pet.owner !== me.uid) throw new Oops('Solo quien creó el hogar puede cambiar el código.');
          const code = newCode(randomInt);
          tx.update(ref, { inviteCode: code });
          return code;
        });
        return NextResponse.json({ inviteCode });
      }

      // Enlace de la imagen del widget de este hogar (lleva su clave): solo para quien vive en él.
      case 'widget': {
        const ref = petRef(body.petId), pet = (await ref.get()).data() as PetData | undefined;
        if (!pet || !(me.uid in (pet.members ?? {}))) throw new Oops('Hogar desconocido.');
        return NextResponse.json({ url: `${new URL(req.url).origin}/api/widget?pet=${ref.id}&k=${widgetKey(ref.id)}` });
      }
    }
    return NextResponse.json({ error: 'Operación desconocida.' }, { status: 400 });
  } catch (e) {
    if (e instanceof Oops) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[home]', e);
    return NextResponse.json({ error: 'Error del servidor.' }, { status: 500 });
  }
}
