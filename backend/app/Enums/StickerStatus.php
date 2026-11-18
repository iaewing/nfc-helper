<?php

namespace App\Enums;

enum StickerStatus: string
{
    case Unclaimed = 'unclaimed';
    case Claimed = 'claimed';
    case Disabled = 'disabled';
}
