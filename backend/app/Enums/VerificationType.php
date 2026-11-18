<?php

namespace App\Enums;

enum VerificationType: string
{
    case Tap = 'tap';
    case TapPhoto = 'tap_photo';
    case TapPhotoLocation = 'tap_photo_location';

    public function requiresPhoto(): bool
    {
        return match ($this) {
            self::TapPhoto, self::TapPhotoLocation => true,
            self::Tap => false,
        };
    }

    public function requiresLocation(): bool
    {
        return $this === self::TapPhotoLocation;
    }
}
