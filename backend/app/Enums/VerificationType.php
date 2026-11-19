<?php

namespace App\Enums;

enum VerificationType: string
{
    case Tap = 'tap';
    case TapPhoto = 'tap_photo';
    case TapLocation = 'tap_location';
    case TapPhotoLocation = 'tap_photo_location';

    public function requiresPhoto(): bool
    {
        return match ($this) {
            self::TapPhoto, self::TapPhotoLocation => true,
            self::Tap, self::TapLocation => false,
        };
    }

    public function requiresLocation(): bool
    {
        return match ($this) {
            self::TapLocation, self::TapPhotoLocation => true,
            self::Tap, self::TapPhoto => false,
        };
    }
}
