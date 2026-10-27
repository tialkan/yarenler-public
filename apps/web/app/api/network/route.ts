import {NextResponse} from 'next/server';
import {network} from '@/server/network';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(await network(),{headers:{'Cache-Control':'private, no-store'}});}catch{return NextResponse.json({kod:'hizmet_hatasi'},{status:503});}}
