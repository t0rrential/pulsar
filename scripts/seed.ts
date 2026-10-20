import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { db, tableName } from '../backend/src/lib/db.js';
import type { Campaign, Creative } from '../backend/src/lib/types.js';

const creativeBaseUrl = (process.env.CREATIVE_BASE_URL || 'http://127.0.0.1:5173/creatives').replace(/\/+$/, '');

const campaigns: Campaign[] = [
  { PK: 'CAMPAIGN#c1', SK: 'META', name: 'Weekend escapes', status: 'active', placements: ['sidebar'], weight: 3 },
  { PK: 'CAMPAIGN#c2', SK: 'META', name: 'Outside every day', status: 'active', placements: ['sidebar'], weight: 2 },
  { PK: 'CAMPAIGN#c3', SK: 'META', name: 'Find your next adventure', status: 'active', placements: ['banner'], weight: 1 },
];

const creatives: Creative[] = [
  {
    PK: 'CAMPAIGN#c1', SK: 'CREATIVE#cr1',
    imageUrl: `${creativeBaseUrl}/escape.svg`,
    headline: 'Your next weekend starts here',
    landingUrl: 'https://www.nps.gov/findapark/index.htm', width: 300, height: 250,
  },
  {
    PK: 'CAMPAIGN#c1', SK: 'CREATIVE#cr2',
    imageUrl: `${creativeBaseUrl}/weekend.svg`,
    headline: 'Take the scenic route',
    landingUrl: 'https://www.nps.gov/subjects/trails/index.htm', width: 300, height: 250,
  },
  {
    PK: 'CAMPAIGN#c2', SK: 'CREATIVE#cr1',
    imageUrl: `${creativeBaseUrl}/outside.svg`,
    headline: 'Make a little room for the outdoors',
    landingUrl: 'https://www.rei.com/learn', width: 300, height: 250,
  },
  {
    PK: 'CAMPAIGN#c3', SK: 'CREATIVE#cr1',
    imageUrl: `${creativeBaseUrl}/adventure.svg`,
    headline: 'Find your next adventure',
    landingUrl: 'https://www.nps.gov/planyourvisit/index.htm', width: 728, height: 90,
  },
  {
    PK: 'CAMPAIGN#c3', SK: 'CREATIVE#cr2',
    imageUrl: `${creativeBaseUrl}/explore.svg`,
    headline: 'A new view is closer than you think',
    landingUrl: 'https://www.nps.gov/subjects/camping/index.htm', width: 728, height: 90,
  },
];

export async function seed(): Promise<void> {
  // Fixed keys overwrite campaign/creative definitions; existing statistics are untouched.
  for (const item of [...campaigns, ...creatives]) {
    await db.send(new PutCommand({ TableName: tableName, Item: item }));
  }
  console.log(`Seeded ${campaigns.length} campaigns and ${creatives.length} creatives into ${tableName}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  seed().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
