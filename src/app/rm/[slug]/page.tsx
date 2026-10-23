import { notFound } from 'next/navigation';
import { RmJourneyWorkspace } from '@/components/RmJourneyWorkspace';
import { RM_PROFILES } from '@/lib/rm-journey-core';
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;if(!RM_PROFILES.some(r=>r.slug===slug))notFound();return <RmJourneyWorkspace key={slug} slug={slug}/>;}
