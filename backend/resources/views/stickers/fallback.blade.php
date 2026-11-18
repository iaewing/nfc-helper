<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ config('app.name') }} — Sticker Tap</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }
        .card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            max-width: 420px;
            width: 100%;
            padding: 32px 24px;
            text-align: center;
        }
        .badge {
            display: inline-block;
            background: #0ea5e9;
            color: #082f49;
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            padding: 4px 10px;
            border-radius: 999px;
            margin-bottom: 16px;
        }
        h1 { font-size: 24px; margin: 0 0 12px; }
        p { color: #cbd5e1; line-height: 1.5; margin: 0 0 24px; }
        .btn {
            display: block;
            background: #38bdf8;
            color: #082f49;
            font-weight: 700;
            text-decoration: none;
            padding: 14px 18px;
            border-radius: 10px;
            margin-bottom: 12px;
        }
        .btn-secondary {
            background: #334155;
            color: #f8fafc;
        }
        .code {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 12px;
            color: #94a3b8;
            word-break: break-all;
            margin-top: 16px;
        }
    </style>
</head>
<body>
    <main class="card">
        <span class="badge">{{ config('app.name') }}</span>
        <h1>{{ $isUnclaimed ? 'Ready to Claim' : 'Prove It Sticker Detected' }}</h1>
        <p>
            @if ($isUnclaimed)
                Open the {{ config('app.name') }} app to claim this physical NFC sticker and link it to a habit.
            @else
                Open this sticker in the {{ config('app.name') }} app to verify your habit check-in.
            @endif
        </p>

        <a class="btn" href="{{ $deepLinkUrl }}">Open in {{ config('app.name') }} App</a>

        @if ($appStoreUrl !== '')
            <a class="btn btn-secondary" href="{{ $appStoreUrl }}">Download for iOS</a>
        @endif

        @if ($playStoreUrl !== '')
            <a class="btn btn-secondary" href="{{ $playStoreUrl }}">Download for Android</a>
        @endif

        <p style="font-size: 13px; margin-bottom: 0;">
            Installing for the first time? Once installed, simply tap your phone to this sticker again.
        </p>

        <div class="code" data-sticker-uuid="{{ $uuid }}">Sticker ID: {{ $uuid }}</div>
    </main>
</body>
</html>
