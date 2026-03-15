# 规则建模指南

## 目录

1. [为什么用伪代码表达规则](#1-为什么用伪代码表达规则)
2. [伪代码书写规范](#2-伪代码书写规范)
3. [规则分类](#3-规则分类)
4. [规则卡片格式](#4-规则卡片格式)
5. [变更标注约定](#5-变更标注约定)
6. [与实体和流程的关联](#6-与实体和流程的关联)
7. [从代码提取规则的技巧](#7-从代码提取规则的技巧)

---

## 1 为什么用伪代码表达规则

- **自然语言太模糊**：同一句话，不同人理解不同，AI 也会歧义理解
- **真实代码太细节**：包含语言特性、框架 API、错误处理样板，淹没业务意图
- **伪代码恰到好处**：只表达业务逻辑意图，对人和 AI 都精确友好

> 原则：最好的 Prompt 就是代码本身，伪代码是其次佳选择。

---

## 2 伪代码书写规范

### 2.1 基本关键字

使用大写英文关键字，逻辑体用缩进表达：

```
IF condition THEN
  action
ELSE IF condition THEN
  action
ELSE
  action
END IF

FOR EACH item IN collection DO
  action
END FOR

WHILE condition DO
  action
END WHILE

TRY
  risky_action
CATCH ErrorType AS e
  handle_error
END TRY

FUNCTION name(param1, param2) -> ReturnType
  logic
  RETURN value
END FUNCTION
```

### 2.2 操作符

| 操作     | 写法                          |
| -------- | ----------------------------- |
| 赋值     | `x = value`                   |
| 比较相等 | `x == y`                      |
| 不等     | `x != y`                      |
| 逻辑与   | `x AND y`                     |
| 逻辑或   | `x OR y`                      |
| 逻辑非   | `NOT x`                       |
| 空值判断 | `x IS NULL` / `x IS NOT NULL` |
| 集合包含 | `x IN collection`             |
| 范围     | `x BETWEEN a AND b`           |

### 2.3 常用操作表达

```
// 数据库查询
user = userRepo.findById(userId)
orders = orderRepo.findByUserId(userId, status=PENDING)

// 抛出异常
THROW ValidationError("message")
THROW BusinessError(ErrorCode.INSUFFICIENT_STOCK, itemId)

// 发布事件
EMIT OrderCreatedEvent(orderId, userId, items)

// 当前时间
NOW()

// 集合操作
list.add(item)
list.remove(item)
list.size()
list.isEmpty()
```

---

## 3 规则分类

### 3.1 校验规则（Validation Rule）

在操作执行前，校验输入或状态是否合法。违反则拒绝操作。

```
规则 V1：用户登录态校验
触发时机：所有需要认证的接口调用前
伪代码：
  IF request.token IS NULL:
    THROW AuthError(MISSING_TOKEN)
  user = tokenService.parse(request.token)
  IF user IS NULL OR user.isExpired():
    THROW AuthError(INVALID_TOKEN)
  IF user.status == BANNED:
    THROW AuthError(USER_BANNED)
```

### 3.2 计算规则（Calculation Rule）

根据输入计算出结果值，通常是数值、状态或派生字段。

```
规则 C1：订单总价计算
触发时机：创建订单时，汇总商品金额
伪代码：
  total = 0
  FOR EACH item IN order.items DO
    total = total + item.quantity * item.unitPrice
  END FOR
  IF order.coupon IS NOT NULL:
    discount = total * order.coupon.discountRate
    total = total - discount
    order.discount = discount
  order.totalAmount = total
```

### 3.3 状态转换规则（State Transition Rule）

定义实体在什么条件下可以从一个状态转移到另一个状态。

```
规则 S1：订单状态流转规则
伪代码：
  FUNCTION canTransit(currentStatus, targetStatus) -> Boolean
    allowedTransitions = {
      PENDING    -> [PAID, CANCELLED],
      PAID       -> [SHIPPED, REFUNDING],
      SHIPPED    -> [COMPLETED],
      REFUNDING  -> [REFUNDED, PAID],
      COMPLETED  -> [],
      CANCELLED  -> [],
      REFUNDED   -> []
    }
    RETURN targetStatus IN allowedTransitions[currentStatus]
  END FUNCTION

  FUNCTION transitStatus(order, targetStatus)
    IF NOT canTransit(order.status, targetStatus):
      THROW BusinessError(INVALID_STATUS_TRANSITION,
            order.status + " -> " + targetStatus)
    order.status = targetStatus
    order.updatedAt = NOW()
    EMIT OrderStatusChangedEvent(order.id, targetStatus)
  END FUNCTION
```

### 3.4 幂等规则（Idempotency Rule）

确保相同操作重复执行不产生副作用。

```
规则 I1：支付结果幂等处理
触发时机：接收支付回调时
伪代码：
  existingPayment = paymentRepo.findByTradeNo(tradeNo)
  IF existingPayment IS NOT NULL:
    IF existingPayment.status == SUCCESS:
      RETURN  // 已处理，直接返回，不重复操作
    IF existingPayment.status == PROCESSING:
      THROW ConcurrentError(PAYMENT_PROCESSING)
  // 继续正常处理流程
```

### 3.5 权限规则（Authorization Rule）

控制特定操作的执行权限。

```
规则 A1：订单取消权限规则
触发时机：用户发起取消订单请求时
伪代码：
  IF order.userId != currentUser.id AND NOT currentUser.isAdmin():
    THROW PermissionError(CANNOT_CANCEL_OTHERS_ORDER)
  IF order.status NOT IN [PENDING, PAID]:
    THROW BusinessError(ORDER_CANNOT_BE_CANCELLED, order.status)
  IF order.status == PAID AND order.paidAt < NOW() - 24 HOURS:
    THROW BusinessError(CANCEL_WINDOW_EXPIRED)
```

---

## 4 规则卡片格式

每条规则用统一格式描述：

```
规则 [编号]：[规则名称]  [标签: NEW/MODIFIED/DELETED]
类型：[校验规则 / 计算规则 / 状态转换规则 / 幂等规则 / 权限规则]
触发时机：[在哪个流程节点、什么条件下触发]
关联实体：[涉及哪些实体]
关联流程：[在哪个序列图的哪个步骤中体现]
伪代码：
  [业务逻辑伪代码]
说明：[对关键决策的额外解释，非必须]
```

---

## 5 变更标注约定

| 标签         | 含义                                       |
| ------------ | ------------------------------------------ |
| `[NEW]`      | 新增规则                                   |
| `[MODIFIED]` | 修改规则，需同时提供变更前和变更后的伪代码 |
| `[DELETED]`  | 删除规则，说明删除原因                     |

**MODIFIED 示例**（展示前后对比）：

```
规则 C1：订单总价计算  [MODIFIED]
变更原因：新增优惠券折扣能力

变更前：
  total = SUM(item.quantity * item.unitPrice FOR item IN order.items)
  order.totalAmount = total

变更后：
  total = SUM(item.quantity * item.unitPrice FOR item IN order.items)
  IF order.couponId IS NOT NULL:
    coupon = couponRepo.findById(order.couponId)
    discount = total * coupon.discountRate
    total = total - discount
    order.discount = discount
  order.totalAmount = total
```

---

## 6 与实体和流程的关联

规则不是孤立存在的，必须明确其在三要素中的位置：

```
规则 R3：优惠券校验规则
关联实体：Order（读 couponId）、Coupon（读取并校验状态）
关联流程：createOrder 序列图的 Step 2（OrderService → CouponService 调用之后执行）
```

**实体-规则-流程的关系总结**：

```
实体（数据结构）
    ↓ 规则操作和校验实体的状态/字段
规则（业务逻辑）
    ↓ 规则被流程在特定时机调用
流程（调用序列）
```

在实施计划中，三者的实现顺序也必须遵循此依赖关系：
先有实体，流程才能引用；先有流程骨架（mock），规则才有"挂载点"。

---

## 7 从代码提取规则的技巧

### 7.1 识别规则的代码特征

| 代码特征                        | 对应规则类型 |
| ------------------------------- | ------------ |
| `if (...) throw`                | 校验规则     |
| `if (...) return error`         | 校验规则     |
| 数值计算、循环累加              | 计算规则     |
| `switch(status)` / 状态机       | 状态转换规则 |
| 操作前先查询是否已存在          | 幂等规则     |
| `currentUser.hasRole(...)`      | 权限规则     |
| `@PreAuthorize` / `@Guard` 注解 | 权限规则     |

### 7.2 提取优先级

只提取**业务意图**，忽略以下技术细节：

- 日志记录（`logger.info(...)`)
- 监控埋点（`metrics.record(...)`)
- 纯框架 API 调用（序列化、Bean 转换等）
- 错误堆栈捕获（`catch (Exception e) { log.error(...) }`）

### 7.3 命名规范

- 规则编号：`V`（Validation）、`C`（Calculation）、`S`（State）、`I`（Idempotency）、`A`（Authorization）+ 数字
- 规则名称：动宾短语，如"库存扣减规则"、"优惠券有效期校验"
