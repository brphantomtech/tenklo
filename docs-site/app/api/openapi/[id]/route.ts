import { openapi } from '@/lib/openapi';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const schemas = await openapi.getSchemas();
    if (!(id in schemas)) return new Response('Not found', { status: 404 });
    return Response.json(schemas[id]!.bundled, { headers: { 'Cache-Control': 'public, max-age=300' } });
}

export async function generateStaticParams() {
    return Object.keys(await openapi.getSchemas()).map((id) => ({ id }));
}
