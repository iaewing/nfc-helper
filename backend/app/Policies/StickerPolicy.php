<?php

namespace App\Policies;

use App\Models\Sticker;
use App\Models\User;

class StickerPolicy
{
    public function view(User $user, Sticker $sticker): bool
    {
        return $sticker->user_id === $user->id;
    }

    public function update(User $user, Sticker $sticker): bool
    {
        return $sticker->user_id === $user->id;
    }

    public function delete(User $user, Sticker $sticker): bool
    {
        return $sticker->user_id === $user->id;
    }
}
