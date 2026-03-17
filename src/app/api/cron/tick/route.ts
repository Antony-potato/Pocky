import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { applyTick, getMood, getNeeds } from '@/lib/petLogic';
import { PetData } from '@/types/pet';

// Inicializa Firebase Admin (solo en el servidor)
function getAdminApp() {
  if (!getApps().length) {
    return initializeApp({
      credential: cert({
        projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getApps()[0];
}

export async function GET(req: NextRequest) {
  // Verifica el secret para que nadie llame este endpoint manualmente
  const secret = req.headers.get('authorization');
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const adminApp = getAdminApp();
    const db  = getFirestore(adminApp);
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
    const newMood = getMood(merged as PetData);
    
    await ref.update({
      ...changes,
      mood:        newMood,
      lastSyncedBy: 'cron',
      updatedAt:    new Date(),
    });

    console.log(`[Cron] Tick aplicado — hunger: ${merged.hunger}, happiness: ${merged.happiness}`);

    // ----- LÓGICA DE NOTIFICACIONES PUSH -----
    const needs = getNeeds(merged as PetData);
    const criticalNeeds = needs.filter(n => n.urgency === 'critical' || n.urgency === 'high');

    if (criticalNeeds.length > 0 && pet.fcmTokens && pet.fcmTokens.length > 0) {
      // Spam prevention cooldown: 4 hours
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      const timeSinceLastNotification = new Date().getTime() - (pet.lastNotificationSent || 0);
      
      if (timeSinceLastNotification > FOUR_HOURS_MS) {
        const messaging = getMessaging(adminApp);
        const title = `¡Pocky te necesita!`;
        const body = criticalNeeds.map(n => n.message).join(' y ');

        const message = {
          notification: {
            title: title,
            body: body,
          },
          tokens: pet.fcmTokens,
        };

        try {
          const response = await messaging.sendEachForMulticast(message);
          console.log(`[Cron] Push notifications sent. Success: ${response.successCount}, Failed: ${response.failureCount}`);
          
          let tokensToKeep = pet.fcmTokens;
          // Limpiamos tokens inválidos si los hay
          if (response.failureCount > 0) {
            const failedTokens: string[] = [];
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                const code = resp.error?.code;
                if (
                  code === 'messaging/invalid-registration-token' ||
                  code === 'messaging/registration-token-not-registered'
                ) {
                  failedTokens.push(pet.fcmTokens![idx]);
                }
              }
            });
            
            if (failedTokens.length > 0) {
              tokensToKeep = pet.fcmTokens.filter(t => !failedTokens.includes(t));
              console.log(`[Cron] Discarded ${failedTokens.length} outdated tokens.`);
            }
          }

          // Register sent notification time and save updated valid tokens directly
          await ref.update({
             lastNotificationSent: new Date().getTime(),
             fcmTokens: tokensToKeep
          });

        } catch (err) {
          console.error('[Cron] Error enviando FCM:', err);
        }
      } else {
         console.log(`[Cron] Push notification avoided by spam cooldown limit.`);
      }
    }

    return NextResponse.json({ success: true, changes });

  } catch (e) {
    console.error('[Cron] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}