package ru.vremya.remindme

import android.app.Activity
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import ru.rustore.sdk.billingclient.RuStoreBillingClientFactory
import ru.rustore.sdk.billingclient.core.model.LoyaltyPurchaseType
import ru.rustore.sdk.billingclient.presentation.PurchaseResult
import ru.rustore.sdk.billingclient.protocol.response.BillingResponsePurchaseProducts

/**
 * MainActivity + нативный мост RuStore Billing (канал "rystore_billing").
 *
 * Dart-сторона (lib/screens/pro_sheet.dart) вызывает:
 *   - purchase {productId} -> String purchaseToken (после успешной оплаты)
 *   - restorePurchases     -> null (серверная сверка делается на Dart-стороне)
 *
 * Токен покупки в RuStore — это purchaseId/purchaseToken, который затем
 * верифицируется НА СЕРВЕРЕ billing-server через RuStore Developer API.
 * Клиенту не доверяем: только сервер знает реальное paidUntil.
 *
 * SDK: ru.rustore.sdk:billing-client (добавить в android/app/build.gradle.kts):
 *   implementation("ru.rustore.sdk:billing-client:0.3.7")
 * репозиторий: maven("https://artifactory-external1.rustoreinfra.ru/artifactory/rustore-public")
 */
class MainActivity : FlutterActivity() {

    private val channelName = "rystore_billing"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "purchase" -> startPurchase(call.argument("productId"), result)
                    "restorePurchases" -> restorePurchases(result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun startPurchase(productId: String?, result: MethodChannel.Result) {
        if (productId.isNullOrEmpty()) {
            result.error("BAD_ARGS", "productId пуст", null)
            return
        }
        // 1. Получаем товар из каталога RuStore (цена/название для экрана оплаты).
        val client = RuStoreBillingClientFactory.getRuStoreBillingClient(applicationContext)
        client.productsService.getProducts(listOf(productId))
            .addOnSuccessListener { response: BillingResponsePurchaseProducts ->
                val product = response.purchaseProducts.firstOrNull()
                if (product == null) {
                    result.error("NO_PRODUCT", "Товар $productId не найден в RuStore", null)
                    return@addOnSuccessListener
                }
                // 2. Открываем экран оплаты RuStore.
                client.paymentService.payForProduct(
                    activityForPayment = this as Activity,
                    productId = productId,
                    loyaltyPurchaseType = LoyaltyPurchaseType.SUBSCRIPTION,
                ).addOnSuccessListener { paymentResult ->
                    when (paymentResult) {
                        is PurchaseResult.Purchased -> {
                            // 3. Токен уходит на Dart -> verifyPurchase на billing-server.
                            result.success(paymentResult.purchase.purchaseToken)
                        }
                        is PurchaseResult.Canceled ->
                            result.error("CANCELED", "Покупка отменена пользователем", null)
                        is PurchaseResult.Error ->
                            result.error("PAY_ERROR", paymentResult.exception.message, null)
                    }
                }.addOnFailureListener { e ->
                    result.error("PAY_FAIL", e.message, null)
                }
            }
            .addOnFailureListener { e ->
                result.error("PRODUCTS_FAIL", e.message, null)
            }
    }

    private fun restorePurchases(result: MethodChannel.Result) {
        // В RuStore восстановление = запрос списка покупок подписки у клиента;
        // статус всё равно определяем по ответу billing-server (deviceId), поэтому
        // здесь лишь подтверждаем, что SDK живой.
        try {
            RuStoreBillingClientFactory.getRuStoreBillingClient(applicationContext)
            result.success(null)
        } catch (e: Exception) {
            result.error("RESTORE_FAIL", e.message, null)
        }
    }
}
