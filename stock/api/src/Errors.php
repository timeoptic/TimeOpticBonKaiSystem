<?php

declare(strict_types=1);

namespace Optic;

/**
 * The one exception the API layer knows how to answer with.
 *
 * Every failure a caller can act on carries a machine-readable `reason` next to
 * the HTTP status. The status says what kind of problem it is; the reason is
 * what the caller's code actually branches on. A message alone is for humans and
 * is never enough — the shop-floor system has to tell "this product is made to
 * order" apart from "we are out of stock", and both are 409.
 */
final class ApiError extends \RuntimeException
{
    /** @param array<string,mixed> $extra */
    public function __construct(
        public readonly int $status,
        public readonly string $reason,
        string $message,
        public readonly array $extra = [],
    ) {
        parent::__construct($message);
    }

    /** The SKU exists but is made to order, so it has no stock to draw down. */
    public static function customMade(string $sku): self
    {
        return new self(409, 'custom_made', "{$sku} เป็นสินค้าสั่งตัด ไม่มีสต็อกให้ตัด", ['sku' => $sku]);
    }

    public static function insufficient(string $sku, int $wanted, int $available): self
    {
        return new self(
            409,
            'insufficient',
            "คงเหลือ {$available} ชิ้น ขอตัด {$wanted} ชิ้น ไม่พอ",
            ['sku' => $sku, 'wanted' => $wanted, 'available' => $available],
        );
    }

    public static function unknownSku(string $sku): self
    {
        return new self(404, 'unknown_sku', "ไม่พบสินค้ารหัส {$sku}", ['sku' => $sku]);
    }

    public static function badRequest(string $message, string $reason = 'bad_request'): self
    {
        return new self(400, $reason, $message);
    }

    public static function unauthorized(string $message = 'ต้องเข้าสู่ระบบก่อน'): self
    {
        return new self(401, 'unauthenticated', $message);
    }

    public static function forbidden(string $message = 'สิทธิ์ของคุณทำรายการนี้ไม่ได้'): self
    {
        return new self(403, 'forbidden', $message);
    }

    public static function notFound(string $message = 'ไม่พบรายการที่ขอ'): self
    {
        return new self(404, 'not_found', $message);
    }

    public static function conflict(string $reason, string $message, array $extra = []): self
    {
        return new self(409, $reason, $message, $extra);
    }

    /** @return array<string,mixed> */
    public function payload(): array
    {
        return ['reason' => $this->reason, 'message' => $this->getMessage()] + $this->extra;
    }
}
