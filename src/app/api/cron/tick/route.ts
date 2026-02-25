import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { applyTick, getMood, getNeeds } from '@/lib/petLogic';
import { PetData } from '@/types/pet';

// Inicializa Firebase Admin (solo en el servidor)
function getAdminDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        // Aquí está el cambio: usamos la variable pública que ya tienes en tu .env.local
        projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

export async function GET(req: NextRequest) {
  // Verifica el secret para que nadie llame este endpoint manualmente
  const secret = req.headers.get('authorization');
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db  = getAdminDb();
    const ref = db.doc('pets/pocky');
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ message: 'No pet found' });
    }

    const pet     = snap.data() as PetData;
    const changes = applyTick(pet);

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ message: 'No changes needed' });
    }

    const merged = { ...pet, ...changes };
    await ref.update({
      ...changes,
      mood:        getMood(merged),
      lastSyncedBy: 'cron',
      updatedAt:    new Date(),
    });

    console.log(`[Cron] Tick aplicado — hunger: ${merged.hunger}, happiness: ${merged.happiness}`);
    return NextResponse.json({ success: true, changes });

  } catch (e) {
    console.error('[Cron] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}