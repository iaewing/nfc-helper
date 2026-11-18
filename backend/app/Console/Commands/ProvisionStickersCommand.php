<?php

namespace App\Console\Commands;

use App\Enums\StickerStatus;
use App\Models\Sticker;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class ProvisionStickersCommand extends Command
{
    protected $signature = 'stickers:provision
        {count=5 : Number of unclaimed stickers to generate}
        {--batch= : Optional batch code (e.g. DEV-001)}';

    protected $description = 'Provision unclaimed NFC sticker UUIDs and print their NDEF tap URLs';

    public function handle(): int
    {
        $count = max(1, (int) $this->argument('count'));
        $batch = $this->option('batch') ?: 'BATCH-'.now()->format('Ymd-His');

        $rows = [];

        for ($i = 0; $i < $count; $i++) {
            $sticker = Sticker::create([
                'uuid' => (string) Str::uuid(),
                'status' => StickerStatus::Unclaimed,
                'batch_code' => $batch,
            ]);

            $rows[] = [$sticker->id, $sticker->uuid, $sticker->tapUrl(), $sticker->batch_code];
        }

        $this->info("Provisioned {$count} sticker(s) in batch [{$batch}]:");
        $this->table(['ID', 'UUID', 'NDEF URL', 'Batch'], $rows);

        return self::SUCCESS;
    }
}
