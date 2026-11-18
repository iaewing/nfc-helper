<?php

namespace App\Enums;

enum CheckInSource: string
{
    case UniversalLink = 'universal_link';
    case ForegroundNfc = 'foreground_nfc';
    case Webhook = 'webhook';
}
