<?php

namespace App\Enums;

enum CheckInStatus: string
{
    case Verified = 'verified';
    case PendingPhoto = 'pending_photo';
    case Rejected = 'rejected';
}
