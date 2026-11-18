<?php

namespace App\Exceptions;

use RuntimeException;

class CheckInRejectedException extends RuntimeException
{
    /**
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $statusCode = 422,
        public readonly array $meta = [],
    ) {
        parent::__construct($message);
    }
}
